import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import {
  parseBroadcasterConfig, DEFAULT_CONFIG, MAX_DELAY_MS,
  type BroadcasterConfig,
} from "../../shared/protocol.ts";
import { LOCALES, NATIVE_NAMES, isLocale } from "../../shared/locale.ts";
import { LayoutEditor } from "./LayoutEditor.tsx";
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

/**
 * Quiet time before a change is written. Twitch rate-limits configuration
 * writes, and a burst (arrow keys through the language menu, a slider or layout
 * drag) used to send one write per step: the later ones were dropped, so the
 * value that stuck was an intermediate one rather than the one picked.
 */
const SAVE_AFTER_MS = 700;

function Config() {
  const [config, setConfig] = useState<BroadcasterConfig>(DEFAULT_CONFIG);
  const [connected, setConnected] = useState(false);
  const [saved, setSaved] = useState(false);

  /** The newest unsaved value, if a write is pending. */
  const pending = useRef<BroadcasterConfig | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = () => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    const ext = window.Twitch?.ext;
    if (!next || !ext) return;
    ext.configuration.set("broadcaster", CONFIG_VERSION, JSON.stringify(next));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  useEffect(() => {
    const ext = window.Twitch?.ext;
    if (!ext) return;

    const load = () => {
      // Twitch echoing back an older value must not undo an edit still waiting to be written.
      if (pending.current) return;
      setConfig(parseBroadcasterConfig(ext.configuration.broadcaster?.content));
      setConnected(true);
    };

    // onChanged only fires once a stored segment exists, so a streamer who has
    // never saved would never see it. onAuthorized covers that case, and either
    // arriving is enough.
    ext.configuration.onChanged(load);
    ext.onAuthorized(load);

    // Closing the dashboard dialog mid-pause still saves the last change.
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const update = (patch: Partial<BroadcasterConfig>) => {
    const next = { ...(pending.current ?? config), ...patch };
    setConfig(next);

    // Saved automatically rather than behind a Save button (a settings page that
    // discards edits because someone closed the tab is a bad trade), but only
    // once the streamer pauses, so a burst of changes is one write of the last.
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_AFTER_MS);
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
        Changes save automatically and reach viewers when their overlay next
        loads. Reload your channel page to check one.
      </p>

      <section>
        <label className="row">
          <input
            type="checkbox"
            checked={config.boardHover}
            onChange={(e) => update({ boardHover: e.target.checked })}
          />
          <span>Show the overlay</span>
        </label>
        <p className="help">
          Viewers hover your board, your hand or the action history to read any
          card in full. Turn this off to hide everything without uninstalling.
        </p>
      </section>

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
          Lines the overlay up with your video, which reaches viewers a few
          seconds late. <strong>If hover targets move before the video does,
          increase it</strong>; if after, decrease it. 4&ndash;6 seconds is
          typical, and Twitch's Stream Manager shows yours.
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
          Covers your action history with a copy viewers can scroll, hover and
          click to see each card played or ability used. Turn it off to leave
          your own list showing.
        </p>
      </section>

      <section>
        <label className="row">
          <input
            type="checkbox"
            checked={config.deckLink}
            onChange={(e) => update({ deckLink: e.target.checked })}
          />
          <span>Deck button</span>
        </label>
        <p className="help">
          Your deck's name, with buttons to copy its link or open it on
          atlas-conquest.com. The link shows your full decklist, so turn this off
          for tournament play.
        </p>
        <span className="label">On mobile, show</span>
        <label className="row">
          <input
            type="radio"
            name="deckView"
            checked={config.deckView === "list"}
            onChange={() => update({ deckView: "list" })}
          />
          <span>The full decklist</span>
        </label>
        <label className="row">
          <input
            type="radio"
            name="deckView"
            checked={config.deckView === "code"}
            onChange={() => update({ deckView: "code" })}
          />
          <span>Just the deck link</span>
        </label>
        <p className="help">
          Phones can't hover, so mobile viewers get a deck panel below the video
          instead, with the same copy and open buttons.
        </p>
      </section>

      <section>
        <label htmlFor="language">Card language</label>
        <select
          id="language"
          value={config.language}
          onChange={(e) => {
            const value = e.target.value;
            update({ language: isLocale(value) ? value : "game" });
          }}
        >
          <option value="game">Same as your game</option>
          {LOCALES.map((code) => (
            <option key={code} value={code}>{NATIVE_NAMES[code]}</option>
          ))}
        </select>
        <label className="row">
          <input
            type="checkbox"
            checked={config.languagePicker}
            onChange={(e) => update({ languagePicker: e.target.checked })}
          />
          <span>Language button for viewers</span>
        </label>
        <p className="help">
          Cards, reminders and buttons in any of the game's eleven languages. By
          default they match your game. With the language button on, each viewer
          can pick their own, and it's remembered on every stream that runs the
          extension.
        </p>
      </section>

      <section>
        <span className="label">Layout</span>
        <p className="help">
          Drag the deck and language buttons to where they fit your scene, and
          choose where hovered cards appear.
        </p>
        <LayoutEditor
          value={{
            deckPos: config.deckPos, languagePos: config.languagePos,
            cardPos: config.cardPos, cardScale: config.cardScale,
          }}
          show={{ deck: config.deckLink, language: config.languagePicker }}
          onChange={(patch) => update(patch)}
        />
      </section>

      <p className="muted small">
        {saved ? "Saved." : connected ? " " : "Not connected to Twitch, so changes can't be saved from here."}
      </p>

      <hr />
      <p className="muted small">
        The overlay only shows your own information. Your opponent's hand never
        reaches your game, so there's nothing for it to reveal.
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Config />);
