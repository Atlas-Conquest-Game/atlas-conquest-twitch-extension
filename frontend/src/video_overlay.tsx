import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { Overlay } from "./Overlay.tsx";
import { SnapshotBuffer } from "./SnapshotBuffer.ts";
import { stringsFor } from "./strings.ts";
import { useBroadcasterConfig, useCards, useLocale, useStreamLocale, useViewerLanguage } from "./twitch.ts";
import type { Snapshot } from "../../shared/protocol.ts";
import "./overlay.css";

const buffer = new SnapshotBuffer();

function App() {
  // Broadcaster settings come from Twitch's Configuration Service, which is
  // free and hosted by them -- our EBS never sees or stores them.
  const config = useBroadcasterConfig();
  const stream = useStreamLocale(buffer);
  const [pick, setPick] = useViewerLanguage();
  const locale = useLocale(config, stream, pick);
  const cards = useCards(locale);

  useEffect(() => { buffer.setDelay(config.delayMs); }, [config.delayMs]);

  useEffect(() => {
    window.Twitch?.ext.listen("broadcast", (_target, _type, message) => {
      try {
        buffer.ingest(JSON.parse(message) as Snapshot);
      } catch (e) {
        console.warn("bad snapshot", e);
      }
    });
  }, []);

  if (!cards) return null;
  // Switched off by the streamer: render nothing at all rather than an empty
  // hit layer, so there is no invisible surface over their video.
  if (!config.boardHover) return null;
  return (
    <Overlay
      buffer={buffer}
      cards={cards}
      t={stringsFor(locale)}
      showDeckLink={config.deckLink}
      showHistory={config.history}
      layout={{ deckPos: config.deckPos, cardPos: config.cardPos, cardScale: config.cardScale }}
      language={config.languagePicker
        ? { current: locale, pick, onPick: setPick, pos: config.languagePos }
        : null}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
