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

test("stat icons become pips with their number; unknown sprites are dropped", () => {
  assert.equal(cardTextToHtml('Costs <sprite name="mana_3"> less'),
    'Costs <span class="ac-icon" data-icon="mana">3</span> less');
  assert.equal(cardTextToHtml('<sprite name="health_X">'), '<span class="ac-icon" data-icon="health">X</span>');
  assert.equal(cardTextToHtml('<sprite name="speed">'), '<span class="ac-icon" data-icon="speed"></span>');
  assert.equal(cardTextToHtml('<sprite name="evil\" onload=\"x">'), "");
  assert.equal(cardTextToHtml("<sprite=3>"), "");
});

test("reminders, mentions and tiles resolve in the viewer's language with English behind", () => {
  const card = { ...payload.cards[0], mentions: [payload.cards[1].id, 123, payload.cards[0].id], tiles: ["lava", "gone"] };
  const data: CardsPayload = { ...payload, cards: [card, ...payload.cards.slice(1)], tileArt: { lava: "tiles/lava.abc.webp" } };
  const english = { names: {}, art: {}, reminders: { [card.id]: "<b>Haste</b>: moves at once." },
    tiles: { lava: { name: "Lava", text: "Burns.", mana: 1, traversable: true } } };
  const local = { names: {}, art: {}, reminders: {}, tiles: { lava: { name: "Lava (de)", text: "Brennt.", mana: 1, traversable: true } } };
  const db = buildCardDatabase(data, { cdnBase: "https://h/t", locale: "de", local, english });
  assert.equal(db.reminderOf(card), "<b>Haste</b>: moves at once.", "falls back to English");
  assert.deepEqual(db.mentionsOf(card).map((c) => c.id), [payload.cards[1].id], "unknown and self dropped");
  const tiles = db.tilesOf(card);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].name, "Lava (de)");
  assert.equal(tiles[0].art, "https://h/t/tiles/lava.abc.webp");
});

test("an ability resolves in the viewer's language with ~ as the unit's short name", () => {
  const card = payload.cards.find((c) => c.name === "Acid Rain")!;
  const data: CardsPayload = { ...payload, abilities: { 7: { icon: "abilities/archery.x.webp", bg: "#111111", fg: "#eeeeee" } } };
  const english = { names: {}, art: {}, abilities: { 7: { name: "Archery", text: "~ deals 2." } } };
  const local = {
    names: { [card.id]: "Säureregen" }, art: {},
    abilities: { 7: { name: "Bogenschießen", text: "~ verursacht 2." } },
    short: { [card.id]: "Regen" },
  };
  const de = buildCardDatabase(data, { cdnBase: "https://h/t", locale: "de", local, english });
  assert.deepEqual(de.abilityOf(7, card), {
    name: "Bogenschießen", text: "Regen verursacht 2.",
    icon: "https://h/t/abilities/archery.x.webp", bg: "#111111", fg: "#eeeeee",
  });

  // No short name: the full localized name. No translation: English words, still the local name.
  const bare = buildCardDatabase(data, {
    cdnBase: "https://h/t", locale: "de", local: { names: { [card.id]: "Säureregen" }, art: {} }, english,
  });
  assert.equal(bare.abilityOf(7, card)?.text, "Säureregen deals 2.");
  assert.equal(bare.abilityOf(99, card), undefined, "an unknown ability is no ability");
});

test("history art is the illustration alone, falling back to the render", () => {
  const card = payload.cards.find((c) => c.name === "Acid Rain")!;
  const english = { names: {}, art: { [card.id]: "en/acid-rain.abc.webp" } };
  const withArt = buildCardDatabase({ ...payload, artwork: { [card.id]: "artwork/acid-rain.1.webp" } },
    { cdnBase: "https://h/t", english });
  assert.equal(withArt.artworkUrl(card), "https://h/t/artwork/acid-rain.1.webp");
  const without = buildCardDatabase({ ...payload, artwork: {} }, { cdnBase: "https://h/t", english });
  assert.equal(without.artworkUrl(card), "https://h/t/en/acid-rain.abc.webp");
});
