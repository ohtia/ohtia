import { supportedLocales, type LocaleChoice, type InterfaceLocale } from "./port.js";

const languageFallbacks: Readonly<Record<string, InterfaceLocale>> = {
  en: "en-US",
  es: "es-ES",
  pt: "pt-PT",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  nl: "nl-NL",
  sv: "sv-SE",
  da: "da-DK",
  nb: "nb-NO",
  no: "nb-NO",
  fi: "fi-FI",
  ca: "ca-AD",
  ko: "ko-KR",
};
export function isInterfaceLocale(value: unknown): value is InterfaceLocale {
  return typeof value === "string" && supportedLocales.some((locale) => locale === value);
}

/** Only the broker supplies OS preferences and an already admitted saved choice. */
export function resolveInterfaceLocale(
  preferences: readonly string[] | undefined,
  explicit?: unknown,
): InterfaceLocale {
  if (isInterfaceLocale(explicit)) return explicit;
  for (const preference of preferences ?? []) {
    try {
      const canonical = Intl.getCanonicalLocales(preference)[0];
      if (!canonical) continue;
      const locale = new Intl.Locale(canonical);
      if (isInterfaceLocale(locale.baseName)) return locale.baseName;
      const regional = locale.region ? `${locale.language}-${locale.region}` : locale.language;
      if (isInterfaceLocale(regional)) return regional;
      const mapped = languageFallbacks[locale.language];
      if (mapped) return mapped;
    } catch {
      /* Invalid OS tags do not suppress the next preference. */
    }
  }
  return "en-US";
}

export function isLocaleChoice(value: unknown): value is LocaleChoice {
  return value === "system" || isInterfaceLocale(value);
}
