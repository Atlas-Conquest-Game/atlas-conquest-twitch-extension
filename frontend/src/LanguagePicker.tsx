import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LOCALES, NATIVE_NAMES, type Locale } from "../../shared/locale.ts";
import type { Strings } from "./strings.ts";

/**
 * The viewer's card-language button: the language in use, and a menu of the
 * game's eleven plus "match the stream".
 *
 * Every entry is written in its own language, so a viewer who cannot read the
 * current one can still find theirs. The pick is the viewer's alone and is
 * remembered by the caller (see useViewerLanguage).
 */
export function LanguagePicker({
  current, pick, onPick, t, style, openUp = false, className = "ac-lang",
}: {
  /** The language cards are shown in right now. */
  current: Locale;
  /** The viewer's own pick, or null when following the stream. */
  pick: Locale | null;
  onPick: (pick: Locale | null) => void;
  t: Strings;
  style?: CSSProperties;
  /** Open the menu upward, for a button low on the video. */
  openUp?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Closes on any press outside, as a menu does.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const choose = (next: Locale | null) => {
    onPick(next);
    setOpen(false);
  };

  return (
    <div className={className} style={style} ref={root} data-open={open} data-up={openUp}>
      <button
        type="button"
        className="ac-lang-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.language}
        title={t.language}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ac-lang-glyph" aria-hidden="true">文A</span>
        <span className="ac-lang-current">{NATIVE_NAMES[current]}</span>
      </button>

      {open && (
        <ul className="ac-lang-menu" role="listbox" aria-label={t.language}>
          <li>
            <button type="button" role="option" aria-selected={pick === null} onClick={() => choose(null)}>
              {t.matchStream}
            </button>
          </li>
          {LOCALES.map((code) => (
            <li key={code}>
              <button type="button" role="option" aria-selected={pick === code} lang={code}
                      onClick={() => choose(code)}>
                {NATIVE_NAMES[code]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
