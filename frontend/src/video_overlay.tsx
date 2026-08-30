import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Overlay } from "./Overlay.tsx";
import { SnapshotBuffer } from "./SnapshotBuffer.ts";
import { loadCards, type CardDatabase } from "./cards.ts";
import type { Snapshot } from "../../shared/protocol.ts";
import "./overlay.css";

declare global {
  interface Window {
    Twitch?: {
      ext: {
        onAuthorized(cb: (auth: { channelId: string }) => void): void;
        listen(topic: string, cb: (target: string, type: string, msg: string) => void): void;
        configuration: { broadcaster?: { content: string } };
      };
    };
  }
}

const buffer = new SnapshotBuffer();

function App() {
  const [cards, setCards] = useState<CardDatabase | null>(null);

  useEffect(() => {
    loadCards().then(setCards).catch((e) => console.error("card data", e));

    const ext = window.Twitch?.ext;
    if (!ext) return;

    // Broadcaster settings come from Twitch's Configuration Service, which is
    // free and hosted by them -- our EBS never sees or stores them.
    ext.onAuthorized(() => {
      try {
        const raw = ext.configuration.broadcaster?.content;
        if (raw) {
          const config = JSON.parse(raw) as { delayMs?: number };
          if (typeof config.delayMs === "number") buffer.setDelay(config.delayMs);
        }
      } catch (e) {
        // A malformed config must not take the overlay down; the default delay
        // is still a usable experience.
        console.warn("broadcaster config unreadable, using defaults", e);
      }
    });

    ext.listen("broadcast", (_target, _type, message) => {
      try {
        buffer.ingest(JSON.parse(message) as Snapshot);
      } catch (e) {
        console.warn("bad snapshot", e);
      }
    });
  }, []);

  if (!cards) return null;
  return <Overlay buffer={buffer} cards={cards} />;
}

createRoot(document.getElementById("root")!).render(<App />);
