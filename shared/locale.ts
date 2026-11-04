/**
 * The game's eleven languages, and which one a given viewer sees.
 *
 * Codes are the game's own (Assets/Resources/Localization/<code>.json and
 * CardScreenshots/<code>/), so a card render, a card name and a UI string all
 * come from the same translation the game ships.
 */
export const LOCALES = [
  "en", "de", "es-419", "fr", "it", "ja", "ko", "pl", "pt-BR", "ru", "zh-CN",
] as const;

export type Locale = typeof LOCALES[number];

/** What the streamer picks: follow each viewer's Twitch language, or force one. */
export type LanguageSetting = "auto" | Locale;

/** Each language's name in itself, for the settings menu. */
export const NATIVE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  "es-419": "Español (Latinoamérica)",
  fr: "Français",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
  pl: "Polski",
  "pt-BR": "Português (Brasil)",
  ru: "Русский",
  "zh-CN": "简体中文",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Folder on the card host. Lowercase, matching the website's folders in the same bucket. */
export function localeFolder(locale: Locale): string {
  return locale.toLowerCase();
}

/**
 * The game language closest to a Twitch viewer's.
 *
 * Twitch gives the extension iframe `language` (e.g. "es") and `locale` (e.g.
 * "es-ES") query parameters. Where the game has one variant of a language, every
 * regional variant gets it: a Spaniard reads Latin American Spanish far more
 * easily than English, and a Traditional Chinese reader likewise Simplified.
 */
export function matchTwitchLanguage(language?: string | null, locale?: string | null): Locale {
  const tag = (locale || language || "").toLowerCase().replace("_", "-");
  const base = tag.split("-")[0];

  const exact = LOCALES.find((l) => l.toLowerCase() === tag);
  if (exact) return exact;

  switch (base) {
    case "es": return "es-419";
    case "pt": return "pt-BR";
    case "zh": return "zh-CN";
  }
  return LOCALES.find((l) => l === base) ?? "en";
}

/** The language to render, given the streamer's setting and the viewer's Twitch language. */
export function resolveLocale(
  setting: LanguageSetting,
  twitchLanguage?: string | null,
  twitchLocale?: string | null,
): Locale {
  return setting === "auto" ? matchTwitchLanguage(twitchLanguage, twitchLocale) : setting;
}
