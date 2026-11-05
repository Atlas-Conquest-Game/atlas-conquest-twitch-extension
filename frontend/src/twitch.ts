/**
 * What every viewer page needs from Twitch, in one place: the streamer's
 * settings, the viewer's language and theme, and the card data in that language.
 *
 * The overlay and the mobile panel are separate iframes with separate entry
 * points, but they must agree on all of this, so neither reads Twitch directly.
 */
import { useEffect, useState } from "react";
import {
  parseBroadcasterConfig, DEFAULT_CONFIG, type BroadcasterConfig,
} from "../../shared/protocol.ts";
import { isLocale, resolveLocale, type Locale } from "../../shared/locale.ts";
import type { SnapshotBuffer } from "./SnapshotBuffer.ts";
import { loadCards, type CardDatabase } from "./cards.ts";

/**
 * Twitch appends these to every extension iframe URL. `language` and `locale`
 * are the viewer's Twitch settings, and `theme` is "light" or "dark".
 */
const query = new URLSearchParams(window.location.search);
export const twitchLanguage = query.get("language");
export const twitchLocale = query.get("locale");
export const initialTheme: "light" | "dark" = query.get("theme") === "light" ? "light" : "dark";

/**
 * The broadcaster segment, live.
 *
 * onChanged as well as onAuthorized: a streamer adjusting a setting while live
 * should see it take effect without every viewer reloading. parseBroadcasterConfig
 * degrades per field, so a config written by a newer version keeps the rest.
 */
export function useBroadcasterConfig(): BroadcasterConfig {
  const [config, setConfig] = useState<BroadcasterConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    const ext = window.Twitch?.ext;
    if (!ext) return;
    const apply = () => setConfig(parseBroadcasterConfig(ext.configuration.broadcaster?.content));
    ext.configuration.onChanged(apply);
    ext.onAuthorized(apply);
  }, []);

  return config;
}

/**
 * The viewer's own language pick, remembered in this browser.
 *
 * localStorage in the extension's iframe belongs to the extension's origin, the
 * same on every channel that runs it, so a pick made on one stream follows the
 * viewer to the next. Storage can be blocked (private windows, strict settings),
 * so every access is guarded and the pick then lasts for the page only.
 */
const PICK_KEY = "atlas-conquest:language";

function readPick(): Locale | null {
  try {
    const v = window.localStorage.getItem(PICK_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function useViewerLanguage(): [Locale | null, (pick: Locale | null) => void] {
  const [pick, setPick] = useState<Locale | null>(readPick);
  const choose = (next: Locale | null) => {
    setPick(next);
    try {
      if (next) window.localStorage.setItem(PICK_KEY, next);
      else window.localStorage.removeItem(PICK_KEY);
    } catch {
      // Not remembered; still applies to this page.
    }
  };
  return [pick, choose];
}

/** The game's language as the stream reports it. Polled: it changes perhaps once a session. */
export function useStreamLocale(buffer: SnapshotBuffer): string | null {
  const [locale, setLocale] = useState<string | null>(buffer.streamLocale);
  useEffect(() => {
    const id = window.setInterval(() => setLocale(buffer.streamLocale), 1000);
    return () => window.clearInterval(id);
  }, [buffer]);
  return locale;
}

/** The language this viewer sees: their pick, the streamer's fixed one, the stream's, then their Twitch language. */
export function useLocale(config: BroadcasterConfig, stream: string | null, viewer: Locale | null): Locale {
  return resolveLocale({
    setting: config.language,
    viewer,
    viewerMayChoose: config.languagePicker,
    stream,
    twitchLanguage,
    twitchLocale,
  });
}

/**
 * Card data in the given language. Keeps showing the previous language's data
 * while a new one loads, so a settings change never blanks the page.
 */
export function useCards(locale: Locale): CardDatabase | null {
  const [cards, setCards] = useState<CardDatabase | null>(null);

  useEffect(() => {
    let current = true;
    loadCards(locale)
      .then((db) => { if (current) setCards(db); })
      .catch((e) => console.error("card data", e));
    return () => { current = false; };
  }, [locale]);

  return cards;
}

/** Light or dark, following Twitch's own theme as the viewer switches it. */
export function useTheme(): "light" | "dark" {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    window.Twitch?.ext.onContext?.((ctx) => {
      if (ctx.theme === "light" || ctx.theme === "dark") setTheme(ctx.theme);
    });
  }, []);
  return theme;
}

/**
 * Copy text, from inside Twitch's iframe.
 *
 * The async Clipboard API needs the iframe to be granted clipboard-write, which
 * Twitch does on some surfaces and not others, so execCommand is the fallback.
 * Both need the click that called this. False means neither worked, and the
 * caller should leave the text somewhere the viewer can select it by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
