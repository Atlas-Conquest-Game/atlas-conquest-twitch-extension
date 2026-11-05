import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { SnapshotBuffer } from "./SnapshotBuffer.ts";
import { cardTextToHtml, reminderHtml, resolveDeck, type CardData, type CardDatabase } from "./cards.ts";
import { DeckActions } from "./DeckActions.tsx";
import { stringsFor, type Strings } from "./strings.ts";
import { useBroadcasterConfig, useCards, useLocale, useStreamLocale, useTheme, useViewerLanguage } from "./twitch.ts";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { decodeDeckCode, deckCodeFromUrl } from "../../shared/deckcode.ts";
import type { DeckLink, DeckView, Snapshot } from "../../shared/protocol.ts";
import "./mobile.css";

/**
 * The mobile view: the streamer's deck, as a list or as just its code.
 *
 * Mobile has no hover and no room to draw over the video, so instead of hitboxes
 * this shows what a viewer on a phone most wants to take away: the deck, with one
 * tap to copy it and one to open it on the website.
 *
 * Fed by the same PubSub stream as the overlay. The deck rides on keyframes, so
 * it appears within a few seconds of a match starting, and it is read through the
 * same delay buffer so it never changes ahead of the video.
 */

const buffer = new SnapshotBuffer();

function decode(url: string) {
  const code = deckCodeFromUrl(url);
  return code ? decodeDeckCode(code) : null;
}

/** The deck at the delayed moment on screen. Polled, not per frame: it changes once a match. */
function useDeck(delayMs: number): DeckLink | null {
  const [deck, setDeck] = useState<DeckLink | null>(null);

  useEffect(() => { buffer.setDelay(delayMs); }, [delayMs]);

  useEffect(() => {
    window.Twitch?.ext.listen("broadcast", (_target, _type, message) => {
      try {
        buffer.ingest(JSON.parse(message) as Snapshot);
      } catch (e) {
        console.warn("bad snapshot", e);
      }
    });

    const id = window.setInterval(() => {
      const next = buffer.stateAt(Date.now())?.deck ?? null;
      setDeck((prev) => (prev?.[0] === next?.[0] && prev?.[1] === next?.[1] ? prev : next));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return deck;
}

function App() {
  const config = useBroadcasterConfig();
  const stream = useStreamLocale(buffer);
  const [pick, setPick] = useViewerLanguage();
  const locale = useLocale(config, stream, pick);
  const cards = useCards(locale);
  const theme = useTheme();
  const deck = useDeck(config.delayMs);
  const t = stringsFor(locale);

  let body;
  if (!config.deckLink) body = <p className="m-empty">{t.hidden}</p>;
  else if (!deck || !cards) body = <p className="m-empty">{t.waiting}</p>;
  else body = <DeckPanel deck={deck} cards={cards} t={t} view={config.deckView} />;

  return (
    <main className="m-root" data-theme={theme} lang={locale}>
      {body}
      {config.languagePicker && (
        <LanguagePicker current={locale} pick={pick} onPick={setPick} t={t} openUp className="ac-lang m-lang" />
      )}
    </main>
  );
}

function DeckPanel({
  deck, cards, t, view,
}: { deck: DeckLink; cards: CardDatabase; t: Strings; view: DeckView }) {
  const resolved = useMemo(() => resolveDeck(deck, cards, decode), [deck, cards]);
  const [open, setOpen] = useState<CardData | null>(null);
  // Shown whenever the clipboard refuses, so the link can still be copied by hand.
  const [showLink, setShowLink] = useState(view === "code");
  useEffect(() => setShowLink(view === "code"), [view]);

  const commander = resolved.commander;

  return (
    <>
      <header className="m-head">
        {commander && (
          <button type="button" className="m-commander" onClick={() => setOpen(commander)}
                  aria-label={`${t.commander}: ${cards.nameOf(commander)}`}>
            <img src={cards.artUrl(commander)} alt="" />
          </button>
        )}
        <div className="m-title">
          <h1>{resolved.name}</h1>
          <p className="m-sub">
            {commander && <span>{cards.nameOf(commander)}</span>}
            {view === "list" && resolved.total > 0 && <span>{resolved.total} {t.cards}</span>}
          </p>
        </div>
      </header>

      {showLink && (
        <label className="m-code">
          <span>{t.deckCode}</span>
          <input readOnly value={resolved.url} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}

      <DeckActions url={resolved.url} t={t} onCopyFailed={() => setShowLink(true)} />

      {view === "list" && (
        <ul className="m-list">
          {resolved.entries.map(({ card, count }) => (
            <li key={card.id}>
              <button type="button" className="m-row" onClick={() => setOpen(card)}>
                <span className="m-cost">{card.cost ?? ""}</span>
                <span className="m-name">{cards.nameOf(card)}</span>
                <span className="m-count">&times;{count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="m-sheet" role="dialog" aria-label={cards.nameOf(open)} onClick={() => setOpen(null)}>
          <img src={cards.artUrl(open)} alt={cards.nameOf(open)} />
          <CardExtras card={open} cards={cards} />
          <button type="button" className="ac-btn">{t.close}</button>
        </div>
      )}
    </>
  );
}

/** The keyword reminders, named tiles and created cards, as on the overlay and in game. */
function CardExtras({ card, cards }: { card: CardData; cards: CardDatabase }) {
  const reminder = cards.reminderOf(card);
  const tiles = cards.tilesOf(card);
  const mentions = cards.mentionsOf(card);
  if (!reminder && tiles.length === 0 && mentions.length === 0) return null;
  return (
    <div className="m-extras" onClick={(e) => e.stopPropagation()}>
      {reminder && <div className="m-reminder" dangerouslySetInnerHTML={{ __html: reminderHtml(reminder) }} />}
      {tiles.map((tile) => (
        <div className="m-tile" key={tile.key}>
          {tile.art && <img src={tile.art} alt="" />}
          <div>
            <strong>{tile.name}</strong>
            <div dangerouslySetInnerHTML={{ __html: cardTextToHtml(tile.text) }} />
          </div>
        </div>
      ))}
      {mentions.length > 0 && (
        <div className="m-mentions">
          {mentions.map((m) => <img key={m.id} src={cards.artUrl(m)} alt={cards.nameOf(m)} />)}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
