import { useEffect, useRef, useState } from "react";
import {
  cellToViewport, hexRadius, E,
  type EntityTuple, type DeckLink,
} from "../../shared/protocol.ts";
import { SnapshotBuffer } from "./SnapshotBuffer.ts";
import { cardTextToHtml, type CardDatabase, type CardData } from "./cards.ts";

interface Props {
  buffer: SnapshotBuffer;
  cards: CardDatabase;
  /** Streamer's setting. When false the deck button is not rendered at all. */
  showDeckLink: boolean;
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

/**
 * The hover layer.
 *
 * Repaints on an animation frame rather than on message arrival, because what it
 * draws is a function of *time* (the delayed frame) rather than of the newest
 * snapshot. A pan that ends between two messages still has to release the
 * hitboxes at the right moment.
 */
export function Overlay({ buffer, cards, showDeckLink }: Props) {
  const [hits, setHits] = useState<Hit[]>([]);
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

      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [buffer, cards]);

  const showing = pinned ?? hovered;
  const showingHit = hits.find((h) => h.handle === showing);

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
          aria-label={hit.card.name}
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

      {showDeckLink && deck && <DeckButton deck={deck} />}

      {showingHit && (
        <CardPanel
          hit={showingHit}
          cards={cards}
          pinned={pinned === showingHit.handle}
          onClose={() => setPinned(null)}
        />
      )}
    </div>
  );
}

/**
 * Link to the streamer's deck on the game's website.
 *
 * Sits on the left edge below the player HUD, which is where the game already
 * shows whose deck this is, so the button reads as part of that column rather
 * than as something floating over the board.
 *
 * A real anchor with target="_blank", not a scripted navigation: an extension
 * iframe cannot navigate the page it sits in, and Twitch requires a visible
 * indicator that a link leaves the site -- which the arrow provides.
 */
function DeckButton({ deck }: { deck: DeckLink }) {
  const [name, url] = deck;
  return (
    <a
      className="ac-deck"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${name} on atlas-conquest.com`}
    >
      <span className="ac-deck-name">{name}</span>
      <span className="ac-deck-cta">View Deck <span aria-hidden="true">&#8599;</span></span>
    </a>
  );
}

function CardPanel({
  hit, cards, pinned, onClose,
}: { hit: Hit; cards: CardDatabase; pinned: boolean; onClose: () => void }) {
  const { card } = hit;

  // Flip to the other side when the hex is on the right, so the panel never
  // covers the thing the viewer is pointing at.
  const onRight = hit.left > 55;

  return (
    <div
      className="ac-card"
      data-pinned={pinned}
      style={onRight ? { left: "2%" } : { right: "2%" }}
      onClick={pinned ? onClose : undefined}
    >
      <img className="ac-card-art" src={cards.artUrl(card)} alt={card.name} loading="lazy" />

      <div className="ac-card-body">
        <div className="ac-card-head">
          <span className="ac-card-name">{card.name}</span>
          {card.cost !== undefined && <span className="ac-card-cost">{card.cost}</span>}
        </div>

        {card.type === "MINION" && (
          <div className="ac-card-stats">
            <span>{card.attack} ATK</span>
            <span>{card.speed} SPD</span>
            {/* Live health, not the printed value - the viewer wants the board. */}
            <span>{hit.health} / {card.health} HP</span>
          </div>
        )}

        {card.text && (
          <p className="ac-card-text"
             dangerouslySetInnerHTML={{ __html: cardTextToHtml(card.text) }} />
        )}
        {card.reminder && (
          <p className="ac-card-reminder"
             dangerouslySetInnerHTML={{ __html: cardTextToHtml(card.reminder) }} />
        )}
      </div>

      {pinned && <div className="ac-card-hint">click to close</div>}
    </div>
  );
}
