import { type InterfaceLocale } from "./port.js";
/** Controlled autonyms, independent of the current interface language and runtime casing. */
export const localeAutonyms = {
  "en-US": { lang: "en-US", label: "English (United States)" },
  "en-GB": { lang: "en-GB", label: "English (United Kingdom)" },
  "en-AU": { lang: "en-AU", label: "English (Australia)" },
  "en-CA": { lang: "en-CA", label: "English (Canada)" },
  "es-ES": { lang: "es-ES", label: "Español (España)" },
  "es-MX": { lang: "es-MX", label: "Español (México)" },
  "es-AR": { lang: "es-AR", label: "Español (Argentina)" },
  "pt-BR": { lang: "pt-BR", label: "Português (Brasil)" },
  "pt-PT": { lang: "pt-PT", label: "Português (Portugal)" },
  "fr-FR": { lang: "fr-FR", label: "Français (France)" },
  "fr-CA": { lang: "fr-CA", label: "Français (Canada)" },
  "fr-BE": { lang: "fr-BE", label: "Français (Belgique)" },
  "de-DE": { lang: "de-DE", label: "Deutsch (Deutschland)" },
  "de-AT": { lang: "de-AT", label: "Deutsch (Österreich)" },
  "de-CH": { lang: "de-CH", label: "Deutsch (Schweiz)" },
  "it-IT": { lang: "it-IT", label: "Italiano (Italia)" },
  "nl-NL": { lang: "nl-NL", label: "Nederlands (Nederland)" },
  "nl-BE": { lang: "nl-BE", label: "Nederlands (België)" },
  "sv-SE": { lang: "sv-SE", label: "Svenska (Sverige)" },
  "da-DK": { lang: "da-DK", label: "Dansk (Danmark)" },
  "nb-NO": { lang: "nb-NO", label: "Norsk bokmål (Norge)" },
  "fi-FI": { lang: "fi-FI", label: "Suomi (Suomi)" },
  "ca-AD": { lang: "ca-AD", label: "Català (Andorra)" },
  "ca-ES": { lang: "ca-ES", label: "Català (Espanya)" },
  "ko-KR": { lang: "ko-KR", label: "한국어 (대한민국)" },
} as const satisfies Record<
  InterfaceLocale,
  { readonly lang: InterfaceLocale; readonly label: string }
>;
