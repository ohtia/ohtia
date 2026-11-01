import { supportedLocales, type InterfaceLocale } from "./port.js";
import enUS from "./localization/en-US.json" with { type: "json" };
import enGB from "./localization/en-GB.json" with { type: "json" };
import enAU from "./localization/en-AU.json" with { type: "json" };
import enCA from "./localization/en-CA.json" with { type: "json" };
import esES from "./localization/es-ES.json" with { type: "json" };
import esMX from "./localization/es-MX.json" with { type: "json" };
import esAR from "./localization/es-AR.json" with { type: "json" };
import ptBR from "./localization/pt-BR.json" with { type: "json" };
import ptPT from "./localization/pt-PT.json" with { type: "json" };
import frFR from "./localization/fr-FR.json" with { type: "json" };
import frCA from "./localization/fr-CA.json" with { type: "json" };
import frBE from "./localization/fr-BE.json" with { type: "json" };
import deDE from "./localization/de-DE.json" with { type: "json" };
import deAT from "./localization/de-AT.json" with { type: "json" };
import deCH from "./localization/de-CH.json" with { type: "json" };
import itIT from "./localization/it-IT.json" with { type: "json" };
import nlNL from "./localization/nl-NL.json" with { type: "json" };
import nlBE from "./localization/nl-BE.json" with { type: "json" };
import svSE from "./localization/sv-SE.json" with { type: "json" };
import daDK from "./localization/da-DK.json" with { type: "json" };
import nbNO from "./localization/nb-NO.json" with { type: "json" };
import fiFI from "./localization/fi-FI.json" with { type: "json" };
import caAD from "./localization/ca-AD.json" with { type: "json" };
import caES from "./localization/ca-ES.json" with { type: "json" };
import koKR from "./localization/ko-KR.json" with { type: "json" };

export const messageContracts = {
  title: {
    params: {},
  },
  intro: {
    params: {},
  },
  status_starting: {
    params: {},
  },
  status_ready: {
    params: {},
  },
  status_unavailable: {
    params: {},
  },
  location: {
    params: {},
  },
  missing: {
    params: {},
  },
  located: {
    params: {},
  },
  pending_create: {
    params: {},
  },
  locator_invalid: {
    params: {},
  },
  locator_newer: {
    params: {},
  },
  locator_unreadable: {
    params: {},
  },
  path_rejected: {
    params: {},
  },
  retry: {
    params: {},
  },
  exit: {
    params: {},
  },
  new_window: {
    params: {},
  },
  startup_failed: {
    params: {},
  },
  shutdown_uncertain: {
    params: {},
  },
  resource_failure: {
    params: {},
  },
  storage_ready: {
    params: {},
  },
  storage_failed: {
    params: {},
  },
  recovery_required: {
    params: {},
  },
  publication_uncertain: {
    params: {},
  },
  restore_checkpoint: {
    params: {},
  },
  open_storage: {
    params: {},
  },
  storage_disclosure: {
    params: {},
  },
  appearance: {
    params: {},
  },
  system: {
    params: {},
  },
  light: {
    params: {},
  },
  dark: {
    params: {},
  },
  save: {
    params: {},
  },
  saved: {
    params: {},
  },
  unsaved: {
    params: {},
  },
  save_failed: {
    params: {},
  },
  save_uncertain: {
    params: {},
  },
  refresh_preference: {
    params: {},
  },
  saving: {
    params: {},
  },
  check_save: {
    params: {},
  },
  locale_fallback: {
    params: {},
  },
  retry_required: {
    params: {},
  },
  checkpoint_restored: {
    params: {},
  },
  storage_opening: {
    params: {},
  },
  refresh: {
    params: {},
  },
  "settings.language.title": {
    params: {},
  },
  "settings.language.useSystem": {
    params: {
      locale: "string",
    },
  },
  "settings.language.help": {
    params: {},
  },
  "settings.language.rejected": {
    params: {
      value: "string",
    },
  },
  "settings.language.uncertain": {
    params: {},
  },
  "settings.language.conflict": {
    params: {},
  },
  "settings.language.changed": {
    params: {
      value: "string",
    },
  },
  "settings.language.applyFailed": {
    params: {},
  },
  "settings.language.check": {
    params: {},
  },
  "settings.language.tryAgain": {
    params: {},
  },
  "settings.language.chooseAgain": {
    params: {},
  },
  "settings.language.applyAgain": {
    params: {},
  },
  "settings.language.readFailed": {
    params: {},
  },
  "settings.language.recovered": { params: {} },
} as const;
export type MessageKey = keyof typeof messageContracts;
export type SimpleMessageKey = {
  [K in MessageKey]: keyof (typeof messageContracts)[K]["params"] extends never ? K : never;
}[MessageKey];
export type MessageParameters<K extends MessageKey> = {
  readonly [P in keyof (typeof messageContracts)[K]["params"]]: string;
};
export const messageKeys = Object.keys(messageContracts) as MessageKey[];
export const catalogs = {
  "en-US": enUS,
  "en-GB": enGB,
  "en-AU": enAU,
  "en-CA": enCA,
  "es-ES": esES,
  "es-MX": esMX,
  "es-AR": esAR,
  "pt-BR": ptBR,
  "pt-PT": ptPT,
  "fr-FR": frFR,
  "fr-CA": frCA,
  "fr-BE": frBE,
  "de-DE": deDE,
  "de-AT": deAT,
  "de-CH": deCH,
  "it-IT": itIT,
  "nl-NL": nlNL,
  "nl-BE": nlBE,
  "sv-SE": svSE,
  "da-DK": daDK,
  "nb-NO": nbNO,
  "fi-FI": fiFI,
  "ca-AD": caAD,
  "ca-ES": caES,
  "ko-KR": koKR,
} satisfies Record<
  InterfaceLocale,
  {
    readonly version: number;
    readonly locale: string;
    readonly messages: Record<MessageKey, string>;
  }
>;
if (Object.keys(catalogs).length !== supportedLocales.length)
  throw new Error("Invalid catalog inventory.");
/** Strict parameters and complete catalogs; plain text only, never HTML or per-key fallback. */
export function message<K extends MessageKey>(
  locale: InterfaceLocale,
  key: K,
  ...args: keyof MessageParameters<K> extends never ? [] : [MessageParameters<K>]
): string {
  const template = catalogs[locale].messages[key];
  if (!template) throw new Error("Missing catalog message.");
  const parameters: Record<string, string> = args.length ? args[0] : {};
  const expected = Object.keys(messageContracts[key].params);
  if (
    Object.keys(parameters).length !== expected.length ||
    expected.some((name) => typeof parameters[name] !== "string")
  )
    throw new Error("Invalid message parameters.");
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, name: string) => {
    const value = parameters[name];
    if (typeof value !== "string") throw new Error("Missing message parameter.");
    return value;
  });
}
export function formatNumber(
  locale: InterfaceLocale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(
  locale: InterfaceLocale,
  value: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}
