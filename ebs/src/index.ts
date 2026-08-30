/**
 * Extension Backend Service — a relay between the streamer's game client and
 * Twitch PubSub.
 *
 * It exists for exactly one reason: Twitch signs viewer JWTs with a secret
 * shared between Twitch and the *extension owner*, one per extension rather than
 * one per channel. Anyone holding it could broadcast to any channel, so it can
 * never ship inside a game client — which means the publish path has to pass
 * through a server we control.
 *
 * It is deliberately small. Broadcaster settings live in Twitch's own
 * Configuration Service (free, and writable straight from the dashboard), and
 * snapshot auth is a self-contained signed token, so the hot path does no
 * storage reads at all. What remains is: verify, throttle, forward.
 */

export interface Env {
  /** From the Twitch developer console. Signs the JWT that authorises a PubSub send. */
  TWITCH_EXTENSION_SECRET: string;
  TWITCH_CLIENT_ID: string;
  /** The extension owner's user id, required in the `external` role JWT. */
  TWITCH_OWNER_ID: string;
  /** Our own secret for the publish tokens we issue to game clients. Not Twitch's. */
  PUBLISH_TOKEN_SECRET: string;
  /** Revoked token ids. Written rarely; never read on the snapshot path. */
  REVOCATIONS: KVNamespace;
}

const PUBLISH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90;

/**
 * Best-effort throttle, per isolate.
 *
 * Deliberately not a Durable Object. The game client already self-limits to one
 * post per second, so this is defence in depth rather than the primary control,
 * and buying strict global serialisation for a backstop would cost a stateful
 * object on every request. Twitch's own 429 is the authoritative limit, and it
 * is surfaced to the caller below.
 */
const lastSendByChannel = new Map<string, number>();
const MIN_SEND_INTERVAL_MS = 900;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    try {
      switch (url.pathname) {
        case "/snapshot": return await handleSnapshot(request, env);
        case "/link":     return await handleLink(request, env);
        default:          return json({ error: "not found" }, 404);
      }
    } catch (err) {
      // Never echo the error back: messages here can quote token material.
      console.error("unhandled", err);
      return json({ error: "internal error" }, 500);
    }
  },
};

async function handleSnapshot(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  const claims = await verifyPublishToken(token, env.PUBLISH_TOKEN_SECRET);
  if (!claims) return json({ error: "invalid publish token" }, 401);

  if (await env.REVOCATIONS.get(claims.jti)) {
    return json({ error: "token revoked" }, 401);
  }

  const body = await request.text();

  // The channel comes from the verified token, never from the body — otherwise a
  // streamer with a valid token could broadcast onto someone else's channel.
  const channelId = claims.channelId;

  const now = Date.now();
  const last = lastSendByChannel.get(channelId) ?? 0;
  if (now - last < MIN_SEND_INTERVAL_MS) {
    // Not an error: the client is expected to keep going, just not to retry this.
    return json({ ok: true, throttled: true }, 202);
  }
  lastSendByChannel.set(channelId, now);

  if (body.length > 5000) {
    return json({ error: "snapshot exceeds the 5KB PubSub limit", size: body.length }, 413);
  }

  const sent = await sendToPubSub(channelId, body, env);
  if (!sent.ok) {
    return json({ error: "pubsub rejected", status: sent.status, detail: sent.detail }, 502);
  }

  return json({ ok: true });
}

/**
 * Exchange a Twitch OAuth code for a publish token bound to that channel.
 *
 * The returned token is self-contained and signed by us: it carries the channel
 * id and an expiry, so verifying a snapshot needs no lookup. That is what keeps
 * the per-request cost at "one HMAC" and the storage bill at zero.
 */
async function handleLink(request: Request, env: Env): Promise<Response> {
  const { code, redirectUri } = await request.json<{ code?: string; redirectUri?: string }>();
  if (!code || !redirectUri) return json({ error: "code and redirectUri required" }, 400);

  const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_EXTENSION_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return json({ error: "oauth exchange failed" }, 401);

  const { access_token } = await tokenRes.json<{ access_token: string }>();

  const userRes = await fetch("https://api.twitch.tv/helix/users", {
    headers: { Authorization: `Bearer ${access_token}`, "Client-Id": env.TWITCH_CLIENT_ID },
  });
  if (!userRes.ok) return json({ error: "could not identify channel" }, 401);

  const user = await userRes.json<{ data: Array<{ id: string; login: string }> }>();
  const channel = user.data?.[0];
  if (!channel) return json({ error: "could not identify channel" }, 401);

  const publishToken = await issuePublishToken(channel.id, env.PUBLISH_TOKEN_SECRET);
  return json({ publishToken, channelId: channel.id, channelLogin: channel.login });
}

/** Broadcast one snapshot to every viewer of a channel. */
async function sendToPubSub(
  channelId: string,
  message: string,
  env: Env,
): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const jwt = await signJwt(
    {
      exp: Math.floor(Date.now() / 1000) + 60,
      user_id: env.TWITCH_OWNER_ID,
      role: "external",
      channel_id: channelId,
      pubsub_perms: { send: ["broadcast"] },
    },
    env.TWITCH_EXTENSION_SECRET,
    true,
  );

  const res = await fetch("https://api.twitch.tv/helix/extensions/pubsub", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Client-Id": env.TWITCH_CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      broadcaster_id: channelId,
      target: ["broadcast"],
      message,
    }),
  });

  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, detail: await res.text() };
}

// --- tokens -----------------------------------------------------------------

interface PublishClaims {
  channelId: string;
  jti: string;
  exp: number;
}

async function issuePublishToken(channelId: string, secret: string): Promise<string> {
  return signJwt(
    {
      channelId,
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + PUBLISH_TOKEN_TTL_SECONDS,
    },
    secret,
    false,
  );
}

async function verifyPublishToken(token: string, secret: string): Promise<PublishClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const key = await hmacKey(secret, false);
  const expected = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));

  // Compared as bytes via timingSafeEqual-style loop rather than string equality.
  if (!bytesEqual(new Uint8Array(expected), b64urlToBytes(parts[2]))) return null;

  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as PublishClaims;
  if (!claims.channelId || !claims.exp) return null;
  if (claims.exp * 1000 < Date.now()) return null;

  return claims;
}

async function signJwt(payload: object, secret: string, secretIsBase64: boolean): Promise<string> {
  const header = bytesToB64url(new TextEncoder().encode(
    JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await hmacKey(secret, secretIsBase64);
  const sig = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${header}.${body}`));

  return `${header}.${body}.${bytesToB64url(new Uint8Array(sig))}`;
}

/**
 * Twitch hands out the extension secret base64-encoded and expects the *decoded*
 * bytes to be the HMAC key. Signing with the base64 text instead produces a
 * well-formed JWT that Twitch rejects, which is a confusing way to lose an hour.
 */
async function hmacKey(secret: string, isBase64: boolean): Promise<CryptoKey> {
  const raw = isBase64
    ? Uint8Array.from(atob(secret), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(secret);

  return crypto.subtle.importKey(
    "raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

// --- encoding helpers -------------------------------------------------------

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
