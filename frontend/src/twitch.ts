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
import { resolveLocale, type Locale } from "../../shared/locale.ts";
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

/** The language this viewer sees, given the streamer's setting. */
export function useLocale(config: BroadcasterConfig): Locale {
  return resolveLocale(config.language, twitchLanguage, twitchLocale);
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
