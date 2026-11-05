import test from "node:test";
import assert from "node:assert/strict";
import { matchTwitchLanguage, resolveLocale, localeFolder, isLocale } from "./locale.ts";

test("exact game languages match, case-insensitively", () => {
  assert.equal(matchTwitchLanguage("de", "de-DE"), "de");
  assert.equal(matchTwitchLanguage("pt", "pt-BR"), "pt-BR");
  assert.equal(matchTwitchLanguage("zh", "zh-cn"), "zh-CN");
  assert.equal(matchTwitchLanguage("ja"), "ja");
});

test("regional variants fall to the game's one variant, not to English", () => {
  assert.equal(matchTwitchLanguage("es", "es-ES"), "es-419");
  assert.equal(matchTwitchLanguage("es", "es-MX"), "es-419");
  assert.equal(matchTwitchLanguage("pt", "pt-PT"), "pt-BR");
  assert.equal(matchTwitchLanguage("zh", "zh-TW"), "zh-CN");
  assert.equal(matchTwitchLanguage("fr", "fr-CA"), "fr");
});

test("unsupported or missing languages are English", () => {
  assert.equal(matchTwitchLanguage("nl", "nl-NL"), "en");
  assert.equal(matchTwitchLanguage(undefined, undefined), "en");
  assert.equal(matchTwitchLanguage("", ""), "en");
});

test("the stream's language by default, the viewer's Twitch language until it is known", () => {
  assert.equal(resolveLocale({ setting: "game", stream: "ja", twitchLanguage: "de" }), "ja");
  assert.equal(resolveLocale({ setting: "game", stream: null, twitchLanguage: "de", twitchLocale: "de-DE" }), "de");
  assert.equal(resolveLocale({ setting: "game", stream: "xx", twitchLanguage: "fr" }), "fr", "an unknown game code is ignored");
});

test("a fixed language beats the stream's; the viewer's pick beats both, unless picking is off", () => {
  assert.equal(resolveLocale({ setting: "ko", stream: "ja" }), "ko");
  assert.equal(resolveLocale({ setting: "ko", stream: "ja", viewer: "pl" }), "pl");
  assert.equal(resolveLocale({ setting: "game", stream: "ja", viewer: "pl", viewerMayChoose: false }), "ja");
  assert.equal(resolveLocale({ setting: "game", stream: "ja", viewer: "nope" }), "ja", "a garbled saved pick is ignored");
});

test("host folders are lowercase", () => {
  assert.equal(localeFolder("pt-BR"), "pt-br");
  assert.equal(localeFolder("zh-CN"), "zh-cn");
  assert.ok(isLocale("es-419"));
  assert.ok(!isLocale("es"));
});
