import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_CONFIG, MIN_CARD_SCALE, MAX_CARD_SCALE, type Point } from "../../shared/protocol.ts";

/**
 * Where the deck button and the hovered card sit on the stream, set by dragging
 * them around a 16:9 stand-in for the video.
 *
 * On the config page rather than anywhere in OBS: OBS has no channel to an
 * extension, and the extension draws in the viewer's browser, not in the
 * stream. Positions are fractions of the video, the same space the overlay
 * lays out in, so what is placed here is where viewers see it at any player
 * size.
 *
 * Saves on release, not on every pointer move: each save is a write to Twitch's
 * Configuration Service, which viewers' overlays then receive.
 */

/** Approximate on-video sizes, as fractions of the video, for the stand-in boxes. */
const DECK_SIZE: Point = [0.14, 0.075];
const CARD_WIDTH = 0.26;     // min(300px, 26%) in the overlay; 26% is the binding term at stream sizes
const CARD_ASPECT = 840 / 600; // the render's height over width

export interface LayoutValue {
  deckPos: Point;
  cardPos: "auto" | Point;
  cardScale: number;
}

export function LayoutEditor({
  value, onChange,
}: { value: LayoutValue; onChange: (patch: Partial<LayoutValue>) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ which: "deck" | "card"; pos: Point; grab: Point } | null>(null);
  // The slider previews while it moves and saves once on release.
  const [scale, setScale] = useState<number | null>(null);
  const cardScale = scale ?? value.cardScale;
  const commitScale = () => {
    if (scale !== null && scale !== value.cardScale) onChange({ cardScale: scale });
    setScale(null);
  };

  const cardSize: Point = [CARD_WIDTH * cardScale, CARD_WIDTH * cardScale * CARD_ASPECT * (16 / 9)];
  const sizeOf = (which: "deck" | "card"): Point => (which === "deck" ? DECK_SIZE : cardSize);

  const fraction = (e: ReactPointerEvent): Point => {
    const r = frame.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const start = (which: "deck" | "card", pos: Point) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = fraction(e);
    setDrag({ which, pos, grab: [at[0] - pos[0], at[1] - pos[1]] });
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const at = fraction(e);
    const [w, h] = sizeOf(drag.which);
    // Kept wholly on the video: a button half off the edge is a button viewers
    // cannot click.
    const x = Math.min(Math.max(at[0] - drag.grab[0], 0), Math.max(0, 1 - w));
    const y = Math.min(Math.max(at[1] - drag.grab[1], 0), Math.max(0, 1 - h));
    setDrag({ ...drag, pos: [round(x), round(y)] });
  };

  const end = () => {
    if (!drag) return;
    onChange(drag.which === "deck" ? { deckPos: drag.pos } : { cardPos: drag.pos });
    setDrag(null);
  };

  const deckPos = drag?.which === "deck" ? drag.pos : value.deckPos;
  const cardPos = drag?.which === "card" ? drag.pos : value.cardPos;

  return (
    <div className="layout">
      <div className="layout-frame" ref={frame} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <span className="layout-caption">Your stream</span>
        <div
          className="layout-item layout-deck"
          data-dragging={drag?.which === "deck"}
          style={box(deckPos, DECK_SIZE)}
          onPointerDown={start("deck", value.deckPos)}
          role="slider"
          aria-label="Deck button position"
        >
          Deck
        </div>
        {cardPos !== "auto" && (
          <div
            className="layout-item layout-card"
            data-dragging={drag?.which === "card"}
            style={box(cardPos, cardSize)}
            onPointerDown={start("card", cardPos)}
            role="slider"
            aria-label="Hovered card position"
          >
            Card
          </div>
        )}
      </div>

      <div className="layout-controls">
        <label className="row">
          <input
            type="radio"
            name="cardPos"
            checked={value.cardPos === "auto"}
            onChange={() => onChange({ cardPos: "auto" })}
          />
          <span>Card beside what's hovered</span>
        </label>
        <label className="row">
          <input
            type="radio"
            name="cardPos"
            checked={value.cardPos !== "auto"}
            onChange={() => onChange({ cardPos: [0.72, 0.06] })}
          />
          <span>Card in a fixed spot (drag it above)</span>
        </label>

        <label htmlFor="cardScale">
          Card size <strong>{Math.round(cardScale * 100)}%</strong>
        </label>
        <input
          id="cardScale"
          type="range"
          min={MIN_CARD_SCALE}
          max={MAX_CARD_SCALE}
          step={0.05}
          value={cardScale}
          onChange={(e) => setScale(Number(e.target.value))}
          onPointerUp={commitScale}
          onKeyUp={commitScale}
          onBlur={commitScale}
        />

        <button
          type="button"
          className="layout-reset"
          onClick={() => onChange({ deckPos: DEFAULT_CONFIG.deckPos, cardPos: DEFAULT_CONFIG.cardPos, cardScale: DEFAULT_CONFIG.cardScale })}
        >
          Reset layout
        </button>
      </div>
    </div>
  );
}

function box(pos: Point, size: Point) {
  return {
    left: `${pos[0] * 100}%`,
    top: `${pos[1] * 100}%`,
    width: `${size[0] * 100}%`,
    height: `${Math.min(size[1], 1) * 100}%`,
  };
}

/** Three decimals: finer than a pixel at 1440p, and keeps the stored config short. */
function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
