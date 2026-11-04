import test from "node:test";
import assert from "node:assert/strict";
import { decodeDeckCode, deckCodeFromUrl } from "./deckcode.ts";

// Real codes, written by the game and stored in the website's analytics data.
const STARTER_GOBLINS = "wo1TdGFydGVyIEdvYmxpbnM=:K8DAAgwtwJACDCpAEAMMM8AAAwwvwEAEDEiAwAcMR4AQAAw0gAA=";

test("decodes commander, name and cards from a game-written code", () => {
  const deck = decodeDeckCode(STARTER_GOBLINS);
  assert.ok(deck);
  assert.equal(deck.commander, 141);
  assert.equal(deck.name, "Starter Goblins");
  assert.ok(deck.cards.length > 5);
  for (const c of deck.cards) {
    assert.ok(c.count >= 1 && c.count <= 63);
    assert.ok(c.code >= 0 && c.code < 1 << 14);
  }
});

test("the trailing padding is not read as a card", () => {
  const deck = decodeDeckCode(STARTER_GOBLINS)!;
  // The encoder writes floor(20n / 8) + 1 bytes for n entries; the extra byte is
  // padding and must not surface as a card.
  const bytes = Buffer.from(STARTER_GOBLINS.split(":")[1], "base64").length;
  const n = [...Array(64).keys()].find((k) => Math.floor(20 * k / 8) + 1 === bytes);
  assert.equal(deck.cards.length, n);
  assert.ok(deck.cards.every((c) => c.count > 0));
});

test("reads the code out of a website link, including an escaped one", () => {
  // UnityWebRequest.EscapeURL, as DeckUtils.CreateDeckUrl uses it.
  const escaped = encodeURIComponent(STARTER_GOBLINS);
  const url = `https://atlas-conquest.com/decks/milo-sunstone/?code=${escaped}`;
  assert.equal(deckCodeFromUrl(url), STARTER_GOBLINS);
  assert.equal(deckCodeFromUrl(STARTER_GOBLINS), STARTER_GOBLINS);
  assert.equal(deckCodeFromUrl("https://atlas-conquest.com/decks/"), null);
});

test("garbage is null, not a throw", () => {
  assert.equal(decodeDeckCode("not a code"), null);
  assert.equal(decodeDeckCode("!!!:???"), null);
  assert.equal(decodeDeckCode(":"), null);
});

test("names outside the BMP and in CJK survive", () => {
  const name = "龍の軍団 🐉";
  const prefix = Buffer.from(String.fromCodePoint(7) + name, "utf8").toString("base64");
  const deck = decodeDeckCode(`${prefix}:AAAA`);
  assert.equal(deck?.commander, 7);
  assert.equal(deck?.name, name);
});
