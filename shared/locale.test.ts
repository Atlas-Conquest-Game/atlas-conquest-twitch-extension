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

test("a forced language overrides the viewer's", () => {
  assert.equal(resolveLocale("ko", "de", "de-DE"), "ko");
  assert.equal(resolveLocale("auto", "de", "de-DE"), "de");
});

test("host folders are lowercase", () => {
  assert.equal(localeFolder("pt-BR"), "pt-br");
  assert.equal(localeFolder("zh-CN"), "zh-cn");
  assert.ok(isLocale("es-419"));
  assert.ok(!isLocale("es"));
});
