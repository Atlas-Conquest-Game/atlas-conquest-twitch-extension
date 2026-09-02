import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  parseBroadcasterConfig, DEFAULT_CONFIG, MAX_DELAY_MS,
  type BroadcasterConfig,
} from "../../shared/protocol.ts";
import "./config.css";

/**
 * The streamer's settings page, shown on their Twitch dashboard.
 *
 * Everything here is stored in Twitch's Configuration Service rather than our
 * backend: the broadcaster segment is writable straight from this page, Twitch
 * hosts it for free, and it means a streamer's preferences never touch our
 * infrastructure. The overlay reads the same segment back when a viewer loads it.
 */


/** Segment version Twitch stores alongside the content. */
const CONFIG_VERSION = "1";

function Config() {
  const [config, setConfig] = useState<BroadcasterConfig>(DEFAULT_CONFIG);
  const [connected, setConnected] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const ext = window.Twitch?.ext;
    if (!ext) return;

    const load = () => {
      setConfig(parseBroadcasterConfig(ext.configuration.broadcaster?.content));
      setConnected(true);
    };

    // onChanged only fires once a stored segment exists, so a streamer who has
    // never saved would never see it. onAuthorized covers that case, and either
    // arriving is enough.
    ext.configuration.onChanged(load);
    ext.onAuthorized(load);
  }, []);

  const update = (patch: Partial<BroadcasterConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);

    const ext = window.Twitch?.ext;
    if (!ext) return;

    // Written on every change rather than behind a Save button. There is no
    // partial state worth protecting here, and a settings page that silently
    // discards edits because someone closed the tab is a bad trade for one
    // fewer write.
    ext.configuration.set("broadcaster", CONFIG_VERSION, JSON.stringify(next));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  // Rendered immediately, with defaults, rather than waiting on Twitch's helper.
  // Gating on a callback meant that if neither onAuthorized nor onChanged fired
  // the page sat empty forever -- and an empty settings page gives a streamer
  // nothing to act on, not even the knowledge that something failed.
  const seconds = (config.delayMs / 1000).toFixed(1);

  return (
    <div className="config">
      <h1>Atlas Conquest overlay</h1>
      <p className="muted">
        Changes save automatically. They apply to viewers the next time the
        overlay loads.
      </p>

      <section>
        <label htmlFor="delay">
          Stream delay <strong>{seconds}s</strong>
        </label>
        <input
          id="delay"
          type="range"
          min={0}
          max={MAX_DELAY_MS}
          step={250}
          value={config.delayMs}
          onChange={(e) => update({ delayMs: Number(e.target.value) })}
        />
        <div className="scale">
          <span>0s</span><span>{MAX_DELAY_MS / 1000}s</span>
        </div>
        <p className="help">
          Your viewers see the stream a few seconds after it happens. This tells
          the overlay how far to hold its data back so the two line up.
          <br />
          <strong>If hover targets sit ahead of the video, increase this.</strong>{" "}
          If they lag behind it, decrease. Setting it slightly high is harmless;
          setting it too low is what looks broken. Twitch's Stream Manager shows
          your actual delay, and 4&ndash;6 seconds is typical.
        </p>
      </section>

      <section>
        <label className="row">
          <input
            type="checkbox"
            checked={config.boardHover}
            onChange={(e) => update({ boardHover: e.target.checked })}
          />
          <span>Let viewers hover characters on the board</span>
        </label>
        <p className="help">
          Turn this off to hide the overlay entirely without uninstalling the
          extension.
        </p>
      </section>

      <section>
        <label className="row">
          <input
            type="checkbox"
            checked={config.deckLink}
            onChange={(e) => update({ deckLink: e.target.checked })}
          />
          <span>Show a link to your deck</span>
        </label>
        <p className="help">
          Puts your deck's name on the stream, linking to it on
          atlas-conquest.com. Worth knowing that the link resolves to your full
          decklist, so an opponent watching your stream can read it too. Fine for
          most streams; turn it off for tournament play.
        </p>
      </section>

      <section>
        <label className="row">
          <input
            type="checkbox"
            checked={config.history}
            onChange={(e) => update({ history: e.target.checked })}
          />
          <span>Interactive action history</span>
        </label>
        <p className="help">
          Draws a readable copy of your action history over the one on screen, so
          viewers can scroll it and click an entry to see the card. Turn it off to
          leave your own list visible instead.
        </p>
      </section>

      <p className="muted small">
        {saved ? "Saved." : connected ? " " : "Not connected to Twitch — changes cannot be saved from here."}
      </p>

      <hr />
      <p className="muted small">
        The overlay only ever shows your own information. Your opponent's hand is
        never sent to your game, so there is nothing here that could reveal it.
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Config />);
