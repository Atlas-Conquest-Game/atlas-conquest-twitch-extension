import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cardTextToHtml, buildCardDatabase, resolveDeck, type CardsPayload } from "./cards.ts";
import { decodeDeckCode, deckCodeFromUrl } from "../../shared/deckcode.ts";

const payload = JSON.parse(
  fs.readFileSync(new URL("../../data/cards.json", import.meta.url), "utf8")) as CardsPayload;
const db = buildCardDatabase(payload);
const decode = (url: string) => {
  const code = deckCodeFromUrl(url);
  return code ? decodeDeckCode(code) : null;
};

test("a real deck link resolves to its commander and every card", () => {
  const code = "wo1TdGFydGVyIEdvYmxpbnM=:K8DAAgwtwJACDCpAEAMMM8AAAwwvwEAEDEiAwAcMR4AQAAw0gAA=";
  const url = `https://atlas-conquest.com/decks/x/?code=${encodeURIComponent(code)}`;
  const deck = resolveDeck(["Starter Goblins", url], db, decode);

  assert.equal(deck.commander?.type, "COMMANDER");
  assert.equal(deck.entries.length, decodeDeckCode(code)!.cards.length, "every card resolves");
  assert.equal(deck.total, deck.entries.reduce((n, e) => n + e.count, 0));
  const costs = deck.entries.map((e) => e.card.cost ?? 0);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
});

test("a renamed card's old deck code id shows the current card", () => {
  // Royal Commander (old name, its own id) and Royal Commandant (new) are one card.
  const ids = payload.deckCodes!;
  const current = payload.cards.find((c) => c.name === "Royal Commandant")!;
  assert.equal(ids.filter((id) => id === current.id).length, 2);
});

test("a language without a card's render or name falls back to English", () => {
  const card = payload.cards.find((c) => c.name === "Acid Rain")!;
  const local = { names: { [card.id]: "Säureregen" }, art: {} };
  const english = { names: {}, art: { [card.id]: "en/acid-rain.abc.webp" } };
  const de = buildCardDatabase(payload, { cdnBase: "https://h/t", locale: "de", local, english });
  assert.equal(de.nameOf(card), "Säureregen");
  assert.equal(de.artUrl(card), "https://h/t/en/acid-rain.abc.webp");

  const other = payload.cards.find((c) => c.name !== "Acid Rain")!;
  assert.equal(de.nameOf(other), other.name);
});

test("a link that does not decode still yields the link", () => {
  const deck = resolveDeck(["Mine", "https://atlas-conquest.com/decks/"], db, decode);
  assert.equal(deck.url, "https://atlas-conquest.com/decks/");
  assert.equal(deck.entries.length, 0);
  assert.equal(deck.commander, undefined);
});

test("emphasis tags survive", () => {
  assert.equal(cardTextToHtml("<b>Arrival:</b> deal 2"), "<b>Arrival:</b> deal 2");
});

test("TMP-only tags are dropped but their text is kept", () => {
  assert.equal(cardTextToHtml("Costs <sprite=3> less"), "Costs  less");
  assert.equal(cardTextToHtml("<color=#ffcc00>Gold</color> tile"), "Gold tile");
  assert.equal(cardTextToHtml("<size=120%>Big</size>"), "Big");
});

test("authored markup cannot inject HTML", () => {
  // This ends up in innerHTML, so a card whose text contained a script tag must
  // not become one.
  assert.equal(
    cardTextToHtml("<script>alert(1)</script>"),
    "alert(1)");
  assert.equal(
    cardTextToHtml("<img src=x onerror=alert(1)>"),
    "");
});

test("ampersands and stray angle brackets are escaped", () => {
  assert.equal(cardTextToHtml("Fire & Ice"), "Fire &amp; Ice");
  assert.equal(cardTextToHtml("5 < 6"), "5 &lt; 6");
});

test("newlines become breaks", () => {
  assert.equal(cardTextToHtml("one\ntwo"), "one<br>two");
});
