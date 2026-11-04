import { useEffect, useRef, useState } from "react";
import {
  cellToViewport, hexRadius, E, HAND, HIST, HISTORY_KIND,
  type EntityTuple, type DeckLink, type HandTuple, type HistoryTuple, type Rect,
} from "../../shared/protocol.ts";
import { SnapshotBuffer } from "./SnapshotBuffer.ts";
import { type CardDatabase, type CardData } from "./cards.ts";
import { DeckActions } from "./DeckActions.tsx";
import type { Strings } from "./strings.ts";

interface Props {
  buffer: SnapshotBuffer;
  cards: CardDatabase;
  /** UI text in the viewer's language. */
  t: Strings;
  /** Streamer's setting. When false the deck button is not rendered at all. */
  showDeckLink: boolean;
  /** Streamer's setting for the interactive action-history panel. */
  showHistory: boolean;
}

interface Hit {
  handle: number;
  card: CardData;
  /** CSS percentages, already flipped from Unity's y-up viewport. */
  left: number;
  top: number;
  size: number;
  health: number;
}

/** A hand card's hitbox. Rectangular, and positioned by its own measured rect
 *  rather than through the board's projection. */
interface HandHit {
  handle: number;
  card: CardData;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Unity viewport rect -> CSS percentages, flipping the y axis once. */
function rectToCss(r: Rect) {
  return {
    left: r[0] * 100,
    top: (1 - (r[1] + r[3])) * 100,
    width: r[2] * 100,
    height: r[3] * 100,
  };
}

/**
 * The hover layer.
 *
 * Repaints on an animation frame rather than on message arrival, because what it
 * draws is a function of *time* (the delayed frame) rather than of the newest
 * snapshot. A pan that ends between two messages still has to release the
 * hitboxes at the right moment.
 */
export function Overlay({ buffer, cards, t, showDeckLink, showHistory }: Props) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [handHits, setHandHits] = useState<HandHit[]>([]);
  const [history, setHistory] = useState<HistoryTuple[]>([]);
  const [historyRect, setHistoryRect] = useState<Rect | null>(null);
  const [deck, setDeck] = useState<DeckLink | null>(null);
  const [moving, setMoving] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const state = buffer.stateAt(now);
      const isMoving = buffer.cameraMoving(now);
      setMoving(isMoving);

      // Deliberately outside the isMoving branch below. The deck button is
      // anchored to the player's HUD, not to the board, so panning the camera
      // must not make it flicker along with the hitboxes.
      setDeck((prev) => {
        const next = state?.deck ?? null;
        if (prev === next) return prev;
        if (prev && next && prev[0] === next[0] && prev[1] === next[1]) return prev;
        return next;
      });

      if (!state?.affine || isMoving) {
        setHits((prev) => (prev.length ? [] : prev));
      } else {
        const basis = state.affine;
        // Viewport radius -> CSS box. Doubled because radius is a half-width.
        const size = hexRadius(basis) * 2 * 100;

        const next: Hit[] = [];
        for (const entity of state.entities.values() as Iterable<EntityTuple>) {
          const card = cards.get(entity[E.CardId]);
          if (!card) continue;

          const p = cellToViewport(basis, entity[E.Q], entity[E.R]);
          // Unity's viewport is y-up from the bottom left; CSS is y-down from
          // the top left.
          next.push({
            handle: entity[E.Handle],
            card,
            left: p.x * 100,
            top: (1 - p.y) * 100,
            size,
            health: entity[E.Health],
          });
        }
        setHits(next);
      }

      // The hand has its own motion channel, so it is blanked and restored
      // independently of the board.
      if (!state || buffer.handMoving(now)) {
        setHandHits((prev) => (prev.length ? [] : prev));
      } else {
        const next: HandHit[] = [];
        for (const c of state.hand.values() as Iterable<HandTuple>) {
          const card = cards.get(c[HAND.CardId]);
          if (!card) continue;
          const css = rectToCss([c[HAND.X], c[HAND.Y], c[HAND.W], c[HAND.H]]);
          next.push({ handle: c[HAND.Handle], card, ...css });
        }
        setHandHits(next);
      }

      // History is not blanked by anything: the overlay draws its own copy over
      // the region, so what the streamer's list is doing underneath is
      // irrelevant.
      setHistory((prev) => {
        const next = state?.history ?? [];
        if (prev.length === next.length && prev[prev.length - 1] === next[next.length - 1]) return prev;
        return next;
      });
      setHistoryRect((prev) => {
        const next = state?.historyRect ?? null;
        if (prev === next) return prev;
        if (prev && next && prev.every((v, i) => v === next[i])) return prev;
        return next;
      });

      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [buffer, cards]);

  const showing = pinned ?? hovered;
  const showingHit = hits.find((h) => h.handle === showing)
    ?? handHits.find((h) => h.handle === showing);

  return (
    <div className="ac-overlay" data-moving={moving}>
      {hits.map((hit) => (
        <button
          key={hit.handle}
          className="ac-hit"
          style={{
            left: `${hit.left}%`,
            top: `${hit.top}%`,
            width: `${hit.size}%`,
            aspectRatio: "1",
          }}
          aria-label={cards.nameOf(hit.card)}
          onMouseEnter={() => setHovered(hit.handle)}
          onMouseLeave={() => setHovered((h) => (h === hit.handle ? null : h))}
          onClick={() => setPinned((p) => (p === hit.handle ? null : hit.handle))}
          onContextMenu={(e) => {
            // Right-click mirrors the in-game magnify. Suppress the browser menu,
            // but plain click is bound too -- right-click on a web page surprises
            // people, and on a trackpad it is awkward.
            e.preventDefault();
            setPinned((p) => (p === hit.handle ? null : hit.handle));
          }}
        />
      ))}

      {/* Drawn after the board boxes so a hand card overlapping a low unit wins
          the pointer: the hand is in front on screen, so it must be in front
          here too. */}
      {handHits.map((hit) => (
        <button
          key={hit.handle}
          className="ac-hit ac-hit-hand"
          style={{
            left: `${hit.left}%`,
            top: `${hit.top}%`,
            width: `${hit.width}%`,
            height: `${hit.height}%`,
          }}
          onMouseEnter={() => setHovered(hit.handle)}
          onMouseLeave={() => setHovered((h) => (h === hit.handle ? null : h))}
          onClick={(e) => {
            e.preventDefault();
            setPinned((p) => (p === hit.handle ? null : hit.handle));
          }}
        />
      ))}

      {showHistory && historyRect && (
        <HistoryPanel rect={historyRect} entries={history} cards={cards} />
      )}

      {showDeckLink && deck && <DeckButton deck={deck} t={t} />}

      {showingHit && (
        <CardPanel
          hit={showingHit}
          cards={cards}
          t={t}
          pinned={pinned === showingHit.handle}
          onClose={() => setPinned(null)}
        />
      )}
    </div>
  );
}

/**
 * The streamer's deck: its name, with copy and open.
 *
 * Sits on the left edge below the player HUD, which is where the game already
 * shows whose deck this is, so it reads as part of that column rather than as
 * something floating over the board.
 */
function DeckButton({ deck, t }: { deck: DeckLink; t: Strings }) {
  const [name, url] = deck;
  return (
    <div className="ac-deck">
      <span className="ac-deck-name" title={name}>{name}</span>
      <DeckActions url={url} t={t} compact />
    </div>
  );
}

/**
 * An interactive copy of the game's action history, drawn over the game's own.
 *
 * Replacing the region rather than putting hover boxes on it, because the
 * streamer's list scrolls: boxes would need their own motion channel, would
 * blank on every scroll, and would still leave a viewer unable to look back at
 * anything that had scrolled away. Covering it costs nothing -- the history is a
 * static log, so nothing is hidden that was worth watching -- and gives viewers
 * their own scroll position and a crisp list instead of an 80px strip of
 * compressed video.
 *
 * Opaque on purpose. A translucent panel would show the streamer's list bleeding
 * through at a different scroll offset, which reads as a rendering fault.
 */
function HistoryPanel({
  rect, entries, cards,
}: { rect: Rect; entries: HistoryTuple[]; cards: CardDatabase }) {
  const css = rectToCss(rect);
  const [open, setOpen] = useState<number | null>(null);

  // Newest first, matching the game.
  const rows = [...entries].reverse();

  return (
    <div
      className="ac-history"
      style={{
        left: `${css.left}%`,
        top: `${css.top}%`,
        width: `${css.width}%`,
        height: `${css.height}%`,
      }}
    >
      {rows.map((entry) => {
        const card = cards.get(entry[HIST.CardId]);
        if (!card) return null;
        const id = entry[HIST.Id];
        return (
          <button
            key={id}
            className="ac-history-row"
            data-kind={entry[HIST.Kind] === HISTORY_KIND.Ability ? "ability" : "play"}
            data-owner={entry[HIST.Owner]}
            data-open={open === id}
            title={cards.nameOf(card)}
            onClick={() => setOpen((p) => (p === id ? null : id))}
          >
            <img src={cards.artUrl(card)} alt={cards.nameOf(card)} loading="lazy" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * What the card panel needs, which is less than a board hit carries.
 *
 * Narrowed so a hand card can open the same panel: a card in hand has no live
 * health and no hex size, and inventing values for them would put a wrong number
 * on screen rather than omitting one.
 */
interface PanelSource {
  card: CardData;
  /** Horizontal position, used only to decide which side to open on. */
  left: number;
  /** Live health, for a unit on the board. Absent for a card in hand. */
  health?: number;
}

/**
 * The card, as its render in the viewer's language.
 *
 * Only the render, because the render already is the card: name, cost, stats
 * and rules text are all on it, and repeating them as text beside it would say
 * everything twice -- in English, under a card in Japanese. What the render
 * cannot show is the live state of this copy on the board, so that is added.
 */
function CardPanel({
  hit, cards, t, pinned, onClose,
}: { hit: PanelSource; cards: CardDatabase; t: Strings; pinned: boolean; onClose: () => void }) {
  const { card } = hit;

  // Flip to the other side when the hex is on the right, so the panel never
  // covers the thing the viewer is pointing at.
  const onRight = hit.left > 55;

  // Live health for a unit on the board, when it differs from what is printed.
  // A card in hand has none, and an undamaged unit's is already on the render.
  const damaged = hit.health !== undefined && card.health !== undefined && hit.health !== card.health;

  return (
    <div
      className="ac-card"
      data-pinned={pinned}
      style={onRight ? { left: "2%" } : { right: "2%" }}
      onClick={pinned ? onClose : undefined}
    >
      <img className="ac-card-art" src={cards.artUrl(card)} alt={cards.nameOf(card)} />

      {damaged && (
        <div className="ac-card-health" data-hurt={hit.health! < card.health!}>
          <span aria-hidden="true">&#9829;</span> {hit.health} / {card.health}
        </div>
      )}

      {pinned && <div className="ac-card-hint">{t.close}</div>}
    </div>
  );
}
