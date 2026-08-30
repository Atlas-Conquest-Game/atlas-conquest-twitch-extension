import test from "node:test";
import assert from "node:assert/strict";
import { cardTextToHtml } from "./cards.ts";

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
