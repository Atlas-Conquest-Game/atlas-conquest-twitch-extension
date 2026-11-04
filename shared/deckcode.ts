/**
 * Deck codes, as the game writes them (DeckUtils.CreateDeckCode) and the website
 * reads them (site/js/deckcode.js).
 *
 * The snapshot carries the deck as a website link rather than a list, so there is
 * one source of truth for "what is in this deck" and it is the same string a
 * viewer copies. Decoding it here is what turns that link into a decklist on the
 * mobile panel, with no extra bytes on the wire.
 *
 *   <base64 prefix>:<base64 cards>
 *   prefix: UTF-8 string; first code point = commander's deck code id, rest = name
 *   cards:  20 bits per entry, LSB-first (C# BitArray): 14-bit id, 6-bit count
 *
 * Ids here are deck code ids (FullCardList indices), not the wire's card ids.
 * cards.json's `deckCodes` table maps one to the other.
 */

export interface DecodedDeck {
  commander: number;
  name: string;
  cards: Array<{ code: number; count: number }>;
}

/** The ?code= of a deck link, or the input itself if it is already a bare code. */
export function deckCodeFromUrl(urlOrCode: string): string | null {
  const value = urlOrCode.trim();
  if (!value) return null;
  if (!/^https?:/i.test(value)) return value;
  try {
    return new URL(value).searchParams.get("code");
  } catch {
    return null;
  }
}

/** Decode a deck code. Null for anything that is not one, rather than a throw. */
export function decodeDeckCode(code: string): DecodedDeck | null {
  const parts = code.split(":");
  if (parts.length !== 2) return null;

  let prefix: Uint8Array;
  let body: Uint8Array;
  try {
    prefix = base64ToBytes(parts[0]);
    body = base64ToBytes(parts[1]);
  } catch {
    return null;
  }

  const head = new TextDecoder("utf-8").decode(prefix);
  const commander = head.codePointAt(0);
  if (commander === undefined) return null;
  const name = head.slice(commander > 0xffff ? 2 : 1);

  const cards: DecodedDeck["cards"] = [];
  const totalBits = body.length * 8;
  // The encoder sizes the buffer as bits/8 + 1, so there is always padding at
  // the end; it reads as count 0 and is skipped.
  for (let bit = 0; bit + 20 <= totalBits; bit += 20) {
    const id = readBits(body, bit, 14);
    const count = readBits(body, bit + 14, 6);
    if (count > 0) cards.push({ code: id, count });
  }

  return { commander, name, cards };
}

function readBits(bytes: Uint8Array, start: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) {
    const bit = start + i;
    if (bytes[bit >> 3] & (1 << (bit & 7))) value |= 1 << i;
  }
  return value;
}

function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
