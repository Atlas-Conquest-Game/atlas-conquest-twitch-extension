/**
 * The card database the overlay resolves wire ids against.
 *
 * Snapshots carry integer ids only, to stay inside PubSub's 5KB cap. This is
 * where an id becomes something a viewer can read.
 *
 * Fetched from GitHub Pages rather than bundled with the extension: the art alone
 * is ~20MB across 300 cards, far past what belongs in a Twitch-hosted bundle.
 */

export interface CardData {
  id: number;
  /** Art file stem, lowercase. URL is `${CDN}/art/${art}.webp`. */
  art: string;
  name: string;
  type: "MINION" | "SPELL" | "WEAPON" | "COMMANDER" | "NONE";
  subtype?: string;
  cost?: number;
  patron?: string;
  attack?: number;
  speed?: number;
  health?: number;
  power?: number;
  durability?: number;
  legendary?: boolean;
  text?: string;
  reminder?: string;
}

export interface CardDatabase {
  get(id: number): CardData | undefined;
  artUrl(card: CardData): string;
}

// Served from the repo root by GitHub Pages, on a subdomain of the game's own
// domain. The apex belongs to the website -- Pages allows one repository per
// custom domain, so the two cannot share it.
//
// This host is baked into the extension's Twitch allowlist. Changing it means a
// new extension version and another review pass, so it is not a casual edit.
const DEFAULT_CDN = "https://cdn.atlas-conquest.com";

export async function loadCards(cdnBase = DEFAULT_CDN): Promise<CardDatabase> {
  const res = await fetch(`${cdnBase}/data/cards.json`);
  if (!res.ok) throw new Error(`cards.json: ${res.status}`);

  const payload = await res.json() as { artExtension: string; cards: CardData[] };
  const byId = new Map(payload.cards.map((c) => [c.id, c]));
  const ext = payload.artExtension ?? "webp";

  return {
    get: (id) => byId.get(id),
    artUrl: (card) => `${cdnBase}/art/${card.art}.${ext}`,
  };
}

/** Inline emphasis a browser can honour. Everything else TMP-specific is dropped. */
const ALLOWED_TAGS = new Set(["b", "i", "u", "s"]);

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert authored card text into browser-safe HTML.
 *
 * Card text is written for TextMeshPro, so it carries tags a browser has no idea
 * about: `<sprite=3>` for mana icons, `<color=#ffcc00>`, `<size=120%>`. Rendered
 * raw, a viewer would read the markup instead of the card.
 *
 * Tokenised rather than regex-replaced so the escaping is airtight: every run of
 * plain text is escaped, and a tag is only ever re-emitted if its name is on the
 * whitelist. Nothing authored can inject markup, which matters because this text
 * ends up in innerHTML.
 */
export function cardTextToHtml(text: string): string {
  let out = "";
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf("<", i);
    if (open === -1) {
      out += escapeHtml(text.slice(i));
      break;
    }

    out += escapeHtml(text.slice(i, open));

    const close = text.indexOf(">", open);
    if (close === -1) {
      // A stray '<' with no '>' is literal text, not a tag.
      out += escapeHtml(text.slice(open));
      break;
    }

    const inner = text.slice(open + 1, close);
    const isClosing = inner.startsWith("/");
    const name = (isClosing ? inner.slice(1) : inner).split(/[\s=]/)[0].toLowerCase();

    if (ALLOWED_TAGS.has(name)) {
      out += isClosing ? `</${name}>` : `<${name}>`;
    }
    // Anything else is dropped along with its contents' markup, keeping the text.

    i = close + 1;
  }

  return out.replace(/\n/g, "<br>");
}
