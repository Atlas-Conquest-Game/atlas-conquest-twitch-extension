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
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const ext = window.Twitch?.ext;
    if (!ext) {
      // Opened outside Twitch (local dev). Show the form with defaults rather
      // than a blank page, so the layout can still be worked on.
      setReady(true);
      return;
    }

    const load = () => {
      setConfig(parseBroadcasterConfig(ext.configuration.broadcaster?.content));
      setReady(true);
    };

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

  if (!ready) return <div className="config"><p className="muted">Loading…</p></div>;

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

      <p className="muted small">
        {saved ? "Saved." : " "}
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
