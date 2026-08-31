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
  /**
   * The extension's *shared secret*, from Extension Settings > Extension Client
   * Configuration. Base64. Signs the JWT that authorises a PubSub send.
   *
   * This is not the OAuth client secret below. The console offers two unrelated
   * credentials under similar names, they are not interchangeable, and swapping
   * them fails with a plain 401 that names neither.
   */
  TWITCH_EXTENSION_SECRET: string;
  /** The extension's client id. Identifies us on the PubSub broadcast call. */
  TWITCH_CLIENT_ID: string;
  /**
   * Client id used for *user authorization* — the link flow, the helix/users
   * lookup, and the app token behind the live check.
   *
   * Optional, and it exists because the two are not always the same thing. An
   * extension can only be authorized against if its console panel exposes OAuth
   * redirect URIs; where it does not, the redirect URIs live on a separate
   * registered Application, which then has its own client id and secret. Leave
   * this unset and everything falls back to TWITCH_CLIENT_ID, which is correct
   * for the single-registration case.
   *
   * The pairing is what matters: a Twitch call's Client-Id header must match the
   * client that issued the token it carries. Mixing them is a 401 that names
   * neither.
   */
  TWITCH_OAUTH_CLIENT_ID?: string;
  /** OAuth client secret, belonging to whichever client id authorizes users. */
  TWITCH_CLIENT_SECRET: string;
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

/**
 * Whether each channel is currently streaming, cached per isolate.
 *
 * A video-overlay extension only renders over live video, so a snapshot sent
 * while the channel is offline has no possible audience — it is pure cost. The
 * game client cannot know this on its own: it has no idea whether OBS is
 * running, and a linked streamer playing offline would otherwise post ~1,500
 * requests an hour to nobody.
 *
 * Asymmetric TTLs on purpose. Going live is the transition a viewer notices —
 * the overlay stays dead until we spot it — so a stale "offline" is re-checked
 * quickly. A stale "live" only costs a few wasted relays, so it is held longer.
 */
interface LiveState { live: boolean; checkedAt: number }
const liveByChannel = new Map<string, LiveState>();
const LIVE_TTL_MS = 60_000;
const OFFLINE_TTL_MS = 20_000;

/** How long the client should wait before trying again while we are paused. */
const OFFLINE_RETRY_MS = 30_000;

/** App access token for the Helix stream lookup. Valid ~60 days; refreshed early. */
let appToken: { token: string; expiresAt: number } | null = null;

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

  // The channel comes from the verified token, never from the body — otherwise a
  // streamer with a valid token could broadcast onto someone else's channel.
  const channelId = claims.channelId;

  // Nobody can see an overlay on an offline channel. Tell the client to back off
  // rather than relaying into the void. Checked before the body is even read.
  if (!(await isChannelLive(channelId, env))) {
    return json({ ok: true, paused: true, retryAfterMs: OFFLINE_RETRY_MS }, 202);
  }

  const body = await request.text();

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
      client_id: oauthClientId(env),
      client_secret: env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return json({ error: "oauth exchange failed" }, 401);

  const { access_token } = await tokenRes.json<{ access_token: string }>();

  const userRes = await fetch("https://api.twitch.tv/helix/users", {
    headers: { Authorization: `Bearer ${access_token}`, "Client-Id": oauthClientId(env) },
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

/**
 * Client id for user-authorization calls. See Env.TWITCH_OAUTH_CLIENT_ID.
 */
function oauthClientId(env: Env): string {
  return env.TWITCH_OAUTH_CLIENT_ID || env.TWITCH_CLIENT_ID;
}

// --- live check -------------------------------------------------------------

/**
 * Is this channel streaming right now?
 *
 * Fails OPEN. If Twitch is unreachable or rate-limits us, assume live and relay
 * as normal: a few wasted messages cost far less than a streamer's overlay going
 * dark because a side lookup failed.
 */
async function isChannelLive(channelId: string, env: Env): Promise<boolean> {
  const now = Date.now();
  const cached = liveByChannel.get(channelId);
  if (cached) {
    const ttl = cached.live ? LIVE_TTL_MS : OFFLINE_TTL_MS;
    if (now - cached.checkedAt < ttl) return cached.live;
  }

  try {
    const token = await getAppToken(env);
    const res = await fetch(
      `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(channelId)}`,
      { headers: { Authorization: `Bearer ${token}`, "Client-Id": oauthClientId(env) } },
    );
    if (!res.ok) return true;

    const body = await res.json<{ data?: unknown[] }>();
    const live = Array.isArray(body.data) && body.data.length > 0;
    liveByChannel.set(channelId, { live, checkedAt: now });
    return live;
  } catch {
    return true;
  }
}

async function getAppToken(env: Env): Promise<string> {
  // Refresh a minute early so a token never expires mid-request.
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.token;

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthClientId(env),
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error("app token request failed");

  const body = await res.json<{ access_token: string; expires_in: number }>();
  appToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return appToken.token;
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
