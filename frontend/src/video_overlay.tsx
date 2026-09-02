import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Overlay } from "./Overlay.tsx";
import { SnapshotBuffer } from "./SnapshotBuffer.ts";
import { loadCards, type CardDatabase } from "./cards.ts";
import {
  parseBroadcasterConfig, DEFAULT_CONFIG,
  type Snapshot, type BroadcasterConfig,
} from "../../shared/protocol.ts";
import "./overlay.css";


const buffer = new SnapshotBuffer();

function App() {
  const [cards, setCards] = useState<CardDatabase | null>(null);
  const [config, setConfig] = useState<BroadcasterConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    loadCards().then(setCards).catch((e) => console.error("card data", e));

    const ext = window.Twitch?.ext;
    if (!ext) return;

    // Broadcaster settings come from Twitch's Configuration Service, which is
    // free and hosted by them -- our EBS never sees or stores them.
    //
    // parseBroadcasterConfig degrades per-field rather than wholesale, so a
    // config written by a newer version does not reset the streamer's delay.
    const applyConfig = () => {
      const next = parseBroadcasterConfig(ext.configuration.broadcaster?.content);
      buffer.setDelay(next.delayMs);
      setConfig(next);
    };

    // onChanged as well as onAuthorized: a streamer adjusting the delay while
    // live should see it take effect without every viewer reloading.
    ext.configuration.onChanged(applyConfig);
    ext.onAuthorized(applyConfig);

    ext.listen("broadcast", (_target, _type, message) => {
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
      showDeckLink={config.deckLink}
      showHistory={config.history}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
