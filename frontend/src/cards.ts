/**
 * The card database the overlay resolves wire ids against.
 *
 * Snapshots carry integer ids only, to stay inside PubSub's 5KB cap. This is
 * where an id becomes something a viewer can read, in the viewer's language.
 *
 * Fetched from the card host rather than bundled with the extension: the art is
 * ~20MB per language across eleven languages, far past what belongs in a
 * Twitch-hosted bundle. scripts/build_cdn.py writes what is fetched here.
 */
import { localeFolder, type Locale } from "../../shared/locale.ts";

export interface CardData {
  id: number;
  /** Render file stem, lowercase (CardScreenshots/<locale>/<art>.png). */
  art: string;
  /** English name. Use CardDatabase.nameOf for what a viewer reads. */
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
  readonly locale: Locale;
  get(id: number): CardData | undefined;
  /** A card by its deck code id (FullCardList index), as deck codes store them. */
  byDeckCode(code: number): CardData | undefined;
  /** The card's name in the viewer's language, English where it has none. */
  nameOf(card: CardData): string;
  /** The card's render in the viewer's language, English where it has none. */
  artUrl(card: CardData): string;
}

export interface CardsPayload {
  /** Index = deck code id, value = wire id (0 for a retired id). */
  deckCodes?: number[];
  cards: CardData[];
}

/** One language's i18n/<locale>.json: wire id -> name, and wire id -> art path. */
export interface LocaleData {
  names: Record<string, string>;
  art: Record<string, string>;
}

// R2, on the game's own zone, beside the website's localized card renders.
//
// This host is baked into the extension's Twitch allowlist (image and fetch
// domains). Changing it means a new extension version and another review pass,
// so it is not a casual edit.
//
// VITE_CDN overrides it at build time only (e.g. a local cdn-out/ while testing a
// pipeline change); nothing at runtime can point a viewer elsewhere.
export const DEFAULT_CDN: string =
  (import.meta as { env?: { VITE_CDN?: string } }).env?.VITE_CDN
  ?? "https://cards.atlas-conquest.com/twitch";

const requests = new Map<string, Promise<unknown>>();

/** One request per URL per page, however many times the language flips. */
function getJson<T>(url: string): Promise<T> {
  let pending = requests.get(url);
  if (!pending) {
    pending = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.json();
    });
    pending.catch(() => requests.delete(url));
    requests.set(url, pending);
  }
  return pending as Promise<T>;
}

export async function loadCards(locale: Locale, cdnBase = DEFAULT_CDN): Promise<CardDatabase> {
  // English is always loaded too: it is the fallback for any card a language
  // has no render or translation for yet, such as one added since the last run.
  const [payload, english, local] = await Promise.all([
    getJson<CardsPayload>(`${cdnBase}/cards.json`),
    getJson<LocaleData>(`${cdnBase}/i18n/en.json`),
    locale === "en"
      ? Promise.resolve(null)
      : getJson<LocaleData>(`${cdnBase}/i18n/${localeFolder(locale)}.json`).catch(() => null),
  ]);
  return buildCardDatabase(payload, { cdnBase, locale: local ? locale : "en", local, english });
}

export function buildCardDatabase(
  payload: CardsPayload,
  opts: {
    cdnBase?: string;
    locale?: Locale;
    local?: LocaleData | null;
    english?: LocaleData | null;
  } = {},
): CardDatabase {
  const { cdnBase = DEFAULT_CDN, locale = "en", local = null, english = null } = opts;
  const byId = new Map(payload.cards.map((c) => [c.id, c]));
  const deckCodes = payload.deckCodes ?? [];

  return {
    locale,
    get: (id) => byId.get(id),
    byDeckCode: (code) => {
      const id = deckCodes[code];
      return id ? byId.get(id) : undefined;
    },
    nameOf: (card) => local?.names[card.id] ?? card.name,
    artUrl: (card) => {
      const path = local?.art[card.id] ?? english?.art[card.id];
      return path ? `${cdnBase}/${path}` : `${cdnBase}/en/${card.art}.webp`;
    },
  };
}

export interface DeckEntry { card: CardData; count: number }

export interface ResolvedDeck {
  name: string;
  /** The website link, which is also the thing a viewer copies. */
  url: string;
  commander?: CardData;
  /** Cost, then name: the order the game's deck editor lists them in. */
  entries: DeckEntry[];
  total: number;
}

/**
 * A snapshot's deck link, as a decklist.
 *
 * Returns the link even when the code does not decode or a card is unknown to
 * this cards.json: the link still works on the website, and a decklist with a
 * hole in it is better than no way to reach the deck at all.
 */
export function resolveDeck(
  [name, url]: readonly [string, string],
  cards: CardDatabase,
  decode: (url: string) => { commander: number; cards: Array<{ code: number; count: number }> } | null,
): ResolvedDeck {
  const decoded = decode(url);
  const entries: DeckEntry[] = [];
  let total = 0;

  for (const { code, count } of decoded?.cards ?? []) {
    const card = cards.byDeckCode(code);
    if (!card) continue;
    entries.push({ card, count });
    total += count;
  }

  entries.sort((a, b) =>
    (a.card.cost ?? 0) - (b.card.cost ?? 0)
    || cards.nameOf(a.card).localeCompare(cards.nameOf(b.card), cards.locale));

  return {
    name,
    url,
    commander: decoded ? cards.byDeckCode(decoded.commander) : undefined,
    entries,
    total,
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
