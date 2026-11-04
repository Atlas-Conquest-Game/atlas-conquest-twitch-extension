# Atlas Conquest — Twitch Extension

Lets your viewers **hover anything on your stream to read it**. Point at a
character on the board, a card in your hand, or a row in the action history, and
the full card appears — readable, at full resolution, no matter your bitrate.
Click to pin it open.

Also shows your deck, with one click to copy its link (paste it straight into
the game) or open it on atlas-conquest.com. On mobile, where there is no hover,
viewers get your decklist instead.

Cards, card names and the extension's buttons come in all eleven of the game's
languages, following each viewer's Twitch language unless you pick one.

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

Find these under *Extensions → Atlas Conquest → Configure* on your Twitch
dashboard. Changes save as you make them.

| Setting | Default | What it does |
|---|---|---|
| Stream delay | 4s | Aligns the overlay with your delayed video |
| Board hover | on | Hover characters on the board and cards in your hand |
| Deck link | on | Your deck's name on the stream, with copy and open |
| Interactive action history | on | A scrollable copy of your history over the game's own |
| On mobile, show | full decklist | The decklist, or just the deck code (its website link) |
| Card language | each viewer's | Any of the game's eleven languages, for everyone |

The deck link resolves to your full decklist, so an opponent watching can read
it too. Turn it off for tournament play; it hides the mobile panel's deck as
well.

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
mobile gets your deck below the video instead: the decklist (tap a card to see
it) or just the deck code, with copy and open either way. It appears a few
seconds into each match.

---

## For developers

Open source, MIT. Issues and PRs welcome.

### Layout

```
shared/     wire format shared by all three pieces (protocol.ts)
frontend/   viewer pages (overlay, mobile, config) - React + TypeScript, uploaded to Twitch as a zip
ebs/        Extension Backend Service - a Cloudflare Worker that relays to PubSub
scripts/    build_cdn.py + upload_cdn.sh: card content for the card host
data/       cards.json from TwitchCardExporter (generated - do not edit)
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
npm test          # protocol, deck codes, language matching, card data
```

### Running the frontend locally

```bash
cd frontend && npm run dev     # https://localhost:8443
```

HTTPS and port 8080 are both fixed, not preferences. Twitch embeds extension
pages in an iframe on an https origin and a browser will not embed an http one,
and during Local Test it fetches assets from the Testing Base URI literally, so
the port has to match what is registered.

Port 8443, not 8080: MCP for Unity binds `127.0.0.1:8080` whenever the project is
open, and sharing a port across interfaces is worse than a clash, since the
browser chooses between `::1` and `127.0.0.1` on its own and can land on the
plain-HTTP listener.

**First-time setup needs two things, and both fail silently without them.**

*A trusted certificate.* A self-signed one is not enough: Twitch loads the config
page in an iframe, and Chrome refuses an untrusted certificate in a subframe with
no way to click through. Accepting it in a top-level tab does not carry over, and
`--ignore-certificate-errors` is ignored outright by current Chrome. Issue a real
one:

```bash
mkcert -install
cd frontend && mkdir -p certs
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1
```

`certs/` is gitignored; vite picks the files up automatically and warns loudly if
they are missing.

*Local network access.* Chrome blocks a public origin (twitch.tv) from fetching a
loopback address. It shows a permission prompt on the dashboard page — allow it —
or you can grant it under Site settings for `dashboard.twitch.tv`. This affects
local development only; once the extension reaches Hosted Test its assets come
from Twitch's own CDN.

Both failures look identical from the outside: the Configure panel renders empty,
with nothing in the page console. The request appears only in the *supervisor
iframe's* network log, which is a separate target from the page.

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

### Card content

Card renders, card names and the deck code table are fetched at runtime from the
**card host**, `https://cards.atlas-conquest.com/twitch/`: the R2 bucket that
also serves the website's localized card renders. Eleven languages at ~20MB each
is far past what belongs in a Twitch-hosted bundle.

```
twitch/cards.json                    card data, deck codes, mentions, tile art   5-minute cache
twitch/i18n/<locale>.json            one language's names, art, keyword          5-minute cache
                                     reminders and tile names/text
twitch/<locale>/<card>.<hash>.webp   600x840 render                              immutable
twitch/tiles/<tile>.<hash>.webp      tile art                                    immutable
```

Hovering a card shows what the game shows beside it: the keyword reminder box
(keywords and reminder-only abilities, never the card's own text), the tiles it
names, and the cards it creates. The text is rendered by the game itself in each
language (`TwitchCardExporter` switches the game's localization per locale), and
the website's card previews (`site/js/cardpreview.js`) read the same files, so
the game, the site and the extension show the same words.

Art names carry a hash of the source render, so a viewer downloads each card
once and a re-rendered card is a new file. A language missing a card's render or
name falls back to English for that card.

To publish new cards or renders:

```bash
../atlas-conquest/tools/twitch-export.sh   # the game's export: cards.json, i18n/, tiles/ (editor open or closed)
python scripts/build_cdn.py      # reads ../atlas-conquest: TwitchExport/, CardScreenshots/<locale>/, Localization tables
scripts/upload_cdn.sh            # rclone to R2; art first, then the indexes
```

`VITE_CDN=http://localhost:8790/twitch npm run build` points a build at a local
`cdn-out/` for testing; production builds always use the card host. The host is
in the extension's Twitch allowlist (image and fetch domains), so changing it
means a new extension version.
