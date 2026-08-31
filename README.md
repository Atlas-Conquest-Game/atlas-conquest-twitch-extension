# Atlas Conquest — Twitch Extension

Lets your viewers **hover anything on your stream to read it**. Point at a
character on the board, a card in your hand, or a row in the action history, and
the full card appears — readable, at full resolution, no matter your bitrate.
Click to pin it open.

Also shows your starting decklist, with a one-click copy so viewers can play it
themselves.

---

## For streamers

### Setup

1. **Install the extension.** Find *Atlas Conquest* in the Twitch extension
   directory, install it, and activate it as an **overlay**.
2. **Link your channel in-game.** In Atlas Conquest: `Settings → Twitch → Link
   account`. Sign in with the same Twitch account you stream from. That's the
   whole connection — nothing to run alongside the game.
3. **Set your stream delay.** In the extension config on your Twitch dashboard,
   set *Stream delay* to match your broadcast delay (Twitch's Stream Manager
   shows it). Default is 4 seconds.

That's it. Next time you play, viewers can hover.

### Why the delay setting matters

Your viewers' video is a few seconds behind your game. The extension knows what
your board looks like *right now*, but they're watching the past — so it holds
its data back by the delay you set and shows them the board that matches the
frame they're actually looking at.

Set it too low and hover targets drift ahead of the video. Set it a little high
and nothing breaks; the overlay just lags the video slightly. If hovering feels
off by a second or two, nudge this first.

### Settings

| Setting | Default | What it does |
|---|---|---|
| Stream delay | 4s | Aligns the overlay with your delayed video |
| Board hover | on | Hover characters on the board |
| Hand hover | on | Hover the cards in your hand |
| History hover | on | Hover rows in the action history |
| Decklist | on | Shows your starting deck to viewers |
| Share deck code | **off** | Lets viewers copy your list |
| Panel side | right | Which side the decklist sits on |

**A note on "Share deck code".** It's off by default on purpose: anyone watching
your stream — including an opponent — gets your full list. Turn it on for casual
or educational streams; leave it off for ranked or tournament play.

### It only runs while you're live

The overlay publishes during a match, and only when your channel is actually
streaming. If you're playing offline the game notices and stays quiet, so
linking your account once doesn't mean sending data every time you play.

There's a switch in `Settings → Twitch` if you want it off while live. It shows
the current state: *On*, *Off*, or *On (waiting for stream)* when you're linked
and playing but not broadcasting.

### What viewers never see

Only your own information is ever published. Your opponent's hand isn't hidden
from the extension — it was never sent to your game client in the first place,
so there is nothing to leak.

### Troubleshooting

**Nothing appears.** Check the extension is activated as an *overlay* (not a
panel) in your Twitch dashboard, and that the game shows your channel as linked
under `Settings → Twitch`. If that row reads *waiting for stream* while you are
in fact live, give it half a minute: the game re-checks periodically rather than
on every action.

**Hover targets are offset from the board.** Your stream delay setting is off.
Increase it if the overlay leads the video, decrease if it lags.

**Hovering does nothing while I move the camera.** That's deliberate. Hitboxes
switch off while the board is panning or zooming, because they can't track it
accurately at the rate the data is sent. They come back the moment it settles.

**Mobile viewers see a panel, not an overlay.** Twitch mobile has no hover, so
mobile gets the decklist as a panel instead.

---

## For developers

Open source, MIT. Issues and PRs welcome.

### Layout

```
shared/     wire format shared by all three pieces (protocol.ts)
frontend/   the viewer iframe - React + TypeScript, uploaded to Twitch as a zip
ebs/        Extension Backend Service - a Cloudflare Worker that relays to PubSub
art/        card images, served from GitHub Pages (generated - do not edit)
data/       cards.json, likewise generated
```

### How it fits together

```
game client  ──POST──▶  EBS  ──▶  Twitch PubSub  ──▶  viewer iframe
                                                          │
                       card art + cards.json ◀────────────┘
                       broadcaster settings via Twitch's Configuration Service
```

The game client publishes change-driven deltas with a keyframe every 5s. Three
constraints explain most of the design:

- **PubSub allows 5KB per message, ~1/second.** Hence deltas, integer card ids,
  fixed-order entity tuples, and small per-match handles instead of UIDs.
- **Viewers are 3–20s behind live.** The frontend buffers snapshots and renders
  the one matching the delayed video.
- **The board camera pans and zooms**, so hitboxes can't be hardcoded. The
  publisher sends a six-float affine transform (`cell → viewport`); because the
  camera is orthographic and the hex grid is linear, that composition is exactly
  affine, so the frontend places every hex without reimplementing Unity's hex
  layout.

**Camera motion is sent as intervals, not a sampled flag.** A boolean sampled
into each snapshot would miss any pan that starts and ends between two samples,
and would detect onset up to a second late — which is what makes this kind of
overlay look broken. The publisher runs at frame rate and sends exact
`[start, end]` boundaries instead, so the transport rate stops mattering. The
frontend renders at `now - delay`, so its buffer already holds intervals that
begin after the moment on screen; blanking hitboxes at exactly the right frame
is a lookup, not a prediction.

See `shared/protocol.ts` — it's the authority, and it's commented.

### Running the tests

```bash
npm test          # protocol: delta/keyframe folding, motion intervals, projection
```

### Self-hosting

The frontend and EBS are both here, so you can run your own. You'll need to
**register your own extension** on the Twitch developer console and use its
client id and secret.

You cannot point a self-hosted EBS at *our* extension: Twitch signs viewer JWTs
with a secret shared between Twitch and the extension owner, so that secret can
never be distributed. Anyone holding it could forge tokens for any channel. That
is also why there's one hosted EBS rather than one per streamer.

Configure `ebs/wrangler.toml`, then set four secrets and deploy:

```bash
npx wrangler secret put TWITCH_EXTENSION_SECRET   # shared secret (base64), signs PubSub JWTs
npx wrangler secret put TWITCH_CLIENT_ID
npx wrangler secret put TWITCH_CLIENT_SECRET      # OAuth secret, a different credential
npx wrangler secret put TWITCH_OWNER_ID
npx wrangler secret put PUBLISH_TOKEN_SECRET      # ours, not Twitch's
npx wrangler deploy
```

`TWITCH_EXTENSION_SECRET` and `TWITCH_CLIENT_SECRET` are two different values
that the console presents under similar names. The shared secret signs JWTs; the
OAuth secret exchanges authorization codes. Swapping them yields a bare 401.

### Working from a second machine

Secrets live in Cloudflare, not in this repo and not on any developer's disk, so
there is nothing to copy between machines:

```bash
git clone <this repo>
npm install
cd ebs && npx wrangler login     # same Cloudflare account
npx wrangler deploy              # uses the secrets already stored there
```

`wrangler secret list` shows names only, never values — deliberately, and it
means a second machine cannot read them out either. Only `wrangler dev` needs
local values, because it runs the Worker on your machine where there is nothing
to read from; either copy `.dev.vars.example` to `.dev.vars` and fill it in, or
use `wrangler dev --remote` to execute on Cloudflare against the real ones.

Two things that are *not* secrets travel through git instead: the KV namespace id
in `wrangler.toml` (useless without account credentials) and the client ids
(public identifiers, visible in every authorize URL).

On the Unity side, `Atlas Conquest > Twitch > Set Client Id` and `Set EBS Base
Url` write to EditorPrefs, which is per-machine, so re-enter them once on the new
box — or commit the final values into `TwitchLinkSettings`, since neither is
secret. The stored publish token does not transfer and should not: linking again
is one click, and each machine holding its own token means revoking one does not
disturb the other.

**Keep your own copy of the originals.** Twitch shows the shared secret once and
Cloudflare will not read it back, so if both are lost the only route forward is
generating a new one — which invalidates the deployed Worker until every secret
is set again. A password manager entry, made when you first collect them, avoids
that entirely.

### Card art

`art/` and `data/` are generated by `sync.sh --extension` in the (private)
workspace repo, which downscales the game's card screenshots to ~65KB WebP and
emits `cards.json`. Roughly 20MB across ~300 cards — too large for the
Twitch-hosted bundle, which is why it sits outside `frontend/` and is fetched on
demand instead.

GitHub Pages serves them from the repo root at **cdn.atlas-conquest.com**. A
subdomain rather than the apex because `atlas-conquest.com` is the website, and
Pages allows one repository per custom domain. WebP rather than reusing the
website's JPEGs because this is the only per-*viewer* bandwidth in the design,
and the smaller file roughly halves it.
