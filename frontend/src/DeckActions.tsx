import { useEffect, useState } from "react";
import { copyText } from "./twitch.ts";
import type { Strings } from "./strings.ts";

/**
 * Copy the deck link, or open it on the website: the same two things the game's
 * deck editor offers, and the link is the same one the game copies
 * (DeckUtils.CreateDeckUrl), so a viewer can paste it straight into the game.
 *
 * Opening is a real anchor with target="_blank": an extension iframe cannot
 * navigate the page it sits in, and Twitch requires a visible indicator that a
 * link leaves the site, which the arrow provides.
 */
export function DeckActions({
  url, t, compact = false, onCopyFailed,
}: {
  url: string;
  t: Strings;
  /** Short labels, for the overlay button that sits on the video. */
  compact?: boolean;
  /** Called when the clipboard is unavailable, so the caller can expose the link. */
  onCopyFailed?: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  // (ExternalIcon below: a drawn arrow, because "↗" comes from whatever font the
  // label is in, and CJK fonts draw it as something closer to a slash.)

  useEffect(() => {
    if (status === "idle") return;
    const id = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(id);
  }, [status]);

  const copy = async () => {
    const ok = await copyText(url);
    setStatus(ok ? "copied" : "failed");
    if (!ok) onCopyFailed?.();
  };

  return (
    <div className="ac-deck-actions">
      <button type="button" className="ac-btn" onClick={copy} aria-live="polite">
        {status === "copied" ? t.copied : status === "failed" ? t.copyFailed : compact ? t.copy : t.copyLink}
      </button>
      <a className="ac-btn ac-btn-primary" href={url} target="_blank" rel="noopener noreferrer">
        {compact ? t.viewDeck : t.openSite} <ExternalIcon />
      </a>
    </div>
  );
}

/** "Leaves the site", as Twitch requires on an outbound link. */
function ExternalIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"
         stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 2.5H9.5V7.5M9.5 2.5L3 9" />
    </svg>
  );
}
