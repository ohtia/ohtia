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
  "project.type.thesis": { params: {} },
  "limits.section": { params: {} },
  "limits.field": { params: {} },
  "limits.range": { params: { min: "string", max: "string", value: "string" } },
  "limits.subscription": { params: { service: "string" } },
  "limits.apiKey": { params: { service: "string" } },
  "limits.connectionLimit": {
    params: { service: "string", connection_limit: "number" },
    forms: { connection_limit: { kind: "plural" } },
  },
  "limits.running": {
    params: { running: "number", value: "number" },
    forms: { running: { kind: "plural" }, value: { kind: "plural" } },
  },
  "composer.destinationLoading": { params: {} },
  "composer.destinationFailed": { params: {} },
  "composer.refreshDestination": { params: {} },
  "composer.placeholder": { params: { agent: "string" } },
  "composer.counter": {
    params: { used: "number", max: "number" },
    forms: { used: { kind: "plural" }, max: { kind: "plural" } },
  },
  "composer.remove": { params: { excess: "number" }, forms: { excess: { kind: "plural" } } },
  "composer.send": { params: {} },
  "composer.stop": { params: {} },
  "composer.empty": { params: {} },
  "composer.stopping": { params: {} },
  "composer.sending": { params: {} },
  "composer.pendingLimit": { params: {} },
  "composer.inputTooLarge": { params: { agent: "string" } },
  "composer.uncertain": { params: {} },
  "composer.failed": { params: {} },
  "composer.stopFailed": { params: {} },
  "composer.retryStop": { params: {} },
  "composer.subscription": { params: { service: "string", email: "string" } },
  "composer.apiKey": { params: { service: "string" } },
  "composer.reuse": { params: {} },
  "composer.replaceTitle": { params: {} },
  "composer.replaceBody": { params: {} },
  "composer.replace": { params: {} },

  "exit.title": { params: {} },
  "exit.body": { params: { running: "number" }, forms: { running: { kind: "plural" } } },
  "exit.waiting": { params: { running: "number" }, forms: { running: { kind: "plural" } } },
  "exit.queued": { params: {} },
  "exit.wait": { params: {} },
  "exit.cancel": { params: {} },
  "exit.cancelling": { params: {} },
  "settings.closeLayoutNotice": { params: {} },
  "conversation.loading": { params: {} },
  "conversation.empty": { params: {} },
  "conversation.failed": { params: {} },
  "conversation.reload": { params: {} },
  "conversation.unavailable": { params: {} },
  "conversation.earlier": { params: {} },
  "conversation.earlierLoading": { params: {} },
  "conversation.earlierFailed": { params: {} },
  "conversation.copyMessage": { params: {} },
  "conversation.copied": { params: {} },
  "conversation.copyFailed": { params: {} },
  "conversation.opensInBrowser": { params: {} },
  "conversation.codeBlock": { params: {} },
  "conversation.table": { params: {} },
  "conversation.latest": { params: {} },
  "conversation.you": { params: {} },
  "conversation.writing": { params: { agent: "string" } },
  "conversation.replied": { params: { agent: "string" } },

  "connection.title": { params: {} },
  "connection.notConnected": { params: {} },
  "connection.lastAccount": { params: { email: "string" } },
  "connection.notConnectedAccount": { params: { email: "string" } },
  "connection.connected": { params: { email: "string" } },
  "connection.signIn": { params: { service: "string" } },
  "connection.signInAs": { params: { email: "string" } },
  "connection.anotherAccount": { params: {} },
  "connection.waiting": { params: { service: "string" } },
  "connection.cancel": { params: {} },
  "connection.timeout": { params: {} },
  "connection.storeUnavailable": { params: {} },
  "connection.planNotAllowed": { params: { service: "string" } },
  "connection.allowPlan": { params: {} },
  "connection.rejected": { params: { service: "string" } },
  "connection.expired": { params: { service: "string" } },
  "connection.signOut": { params: { service: "string" } },
  "connection.test": { params: {} },
  "connection.testing": { params: { service: "string" } },
  "connection.works": { params: { service: "string" } },
  "connection.models": { params: { models: "string" } },
  "connection.unknownPlan": { params: { service: "string" } },
  "connection.unreachable": { params: { service: "string" } },
  "connection.browserIcon": { params: {} },
  "connection.browserComplete": { params: {} },
  "command.feedback": { params: {} },
  "palette.group.general": { params: {} },
  "palette.group.panels": { params: {} },
  "palette.group.appearance": { params: {} },
  "palette.group.edit": { params: {} },
  "palette.input": { params: {} },
  "palette.results": { params: {} },
  "palette.help": { params: {} },
  "palette.empty": { params: { query: "string" } },
  "shortcuts.group.general": { params: {} },
  "shortcuts.group.panels": { params: {} },
  "shortcuts.group.zoom": { params: {} },
  "shortcuts.group.separator": { params: {} },
  "shortcuts.group.dialogs": { params: {} },
  "shortcuts.action": { params: {} },
  "shortcuts.binding": { params: {} },
  "shortcuts.source": { params: {} },
  "shortcuts.separator.step": { params: {} },
  "shortcuts.separator.largeStep": { params: {} },
  "shortcuts.separator.limits": { params: {} },
  "shortcuts.separator.reset": { params: {} },
  "shortcuts.separator.cancel": { params: {} },
  "identity.ai": { params: {} },
  "identity.human": { params: {} },
  "identity.supervisor": { params: {} },
  "identity.unknown": { params: {} },
  "identity.writingReview": { params: {} },
  "identity.definition": { params: {} },
  "identity.submittedVersion": { params: {} },
  "identity.producer": { params: {} },
  "identity.provider": { params: {} },
  "identity.model": { params: {} },
  "identity.execution": { params: {} },
  "identity.role.virgilio": { params: {} },
  "identity.role.josefa": { params: {} },
  "identity.role.jorge-luis": { params: {} },
  "identity.role.erasmus": { params: {} },
  "identity.role.boris": { params: {} },
  "identity.role.maria": { params: {} },

  "settings.displayFailed": { params: { setting: "string" } },
  "settings.layoutNotRemembered": { params: {} },
  "settings.layoutConflict": { params: {} },
  "settings.title": { params: {} },
  "settings.unavailable": { params: {} },
  "settings.zoomUnavailable": { params: {} },
  "settings.section": { params: {} },
  "settings.immediate": { params: {} },
  "settings.nowLight": { params: {} },
  "settings.nowDark": { params: {} },
  "settings.alwaysLight": { params: {} },
  "settings.alwaysDark": { params: {} },
  "settings.zoomShortcuts": { params: { shortcuts: "string" } },
  "settings.zoomPending": { params: {} },
  "settings.animated": { params: {} },
  "settings.static": { params: {} },
  "settings.hidden": { params: {} },
  "settings.animatedHelp": { params: {} },
  "settings.staticHelp": { params: {} },
  "settings.hiddenHelp": { params: {} },
  "settings.symbolOnly": { params: {} },
  "settings.reducedMotion": { params: {} },
  "settings.layoutHelp": { params: {} },
  "settings.rejected": { params: { setting: "string", value: "string" } },
  "settings.uncertain": { params: { setting: "string" } },
  "settings.conflict": { params: { setting: "string" } },
  "settings.applyFailed": { params: { setting: "string" } },
  "settings.changed": { params: { setting: "string", value: "string" } },
  "settings.readFailed": { params: {} },
  "settings.fallback": { params: { setting: "string" } },
  "command.reason.wide_layout": { params: {} },
  "workspace.helpLayout": { params: {} },
  "workspace.explorer.open": { params: {} },
  "workspace.explorer.hide": { params: {} },
  "workspace.documents.open": { params: {} },
  "workspace.documents.hide": { params: {} },
  "workspace.chat.open": { params: {} },
  "workspace.chat.hide": { params: {} },
  "workspace.contents": { params: {} },
  "workspace.skip": { params: {} },
  "workspace.context": { params: {} },
  "workspace.noProject": { params: {} },
  "workspace.panels": { params: {} },
  "workspace.restore": { params: {} },
  "workspace.zoom": { params: { percent: "string" } },
  "workspace.regions": { params: {} },
  "workspace.navigator": { params: {} },
  "workspace.welcome": { params: {} },
  "workspace.welcomeText": { params: {} },
  "workspace.openSettings": { params: {} },
  "workspace.explorerEmpty": { params: {} },
  "workspace.chatEmpty": { params: {} },
  "workspace.notRemembered": { params: {} },
  "workspace.dismiss": { params: {} },
  "workspace.uncertain": { params: {} },
  "workspace.check": { params: {} },
  "workspace.increase": { params: { panel: "string" } },
  "workspace.reduce": { params: { panel: "string" } },
  "workspace.widths": {
    params: { left: "string", leftWidth: "string", right: "string", rightWidth: "string" },
  },
  "workspace.minimum": { params: { panel: "string", width: "string" } },
  "workspace.separator": { params: { left: "string", right: "string" } },

  "about.copyOutsideFailed": { params: {} },
  "about.loading": { params: {} },
  "about.copying": { params: {} },
  "command.settings.open": { params: {} },
  "command.palette.open": { params: {} },
  "command.shortcuts.open": { params: {} },
  "command.help.open": { params: {} },
  "command.window.new": { params: {} },
  "command.window.close": { params: {} },
  "command.application.quit": { params: {} },
  "command.panels.explorer": { params: {} },
  "command.panels.documents": { params: {} },
  "command.panels.chat": { params: {} },
  "command.document.focus": { params: {} },
  "command.layout.reset": { params: {} },
  "command.theme.system": { params: {} },
  "command.theme.light": { params: {} },
  "command.theme.dark": { params: {} },
  "command.zoom.increase": { params: {} },
  "command.zoom.decrease": { params: {} },
  "command.zoom.reset": { params: {} },
  "command.window.fullscreen": { params: {} },
  "command.menu.open": { params: {} },
  "command.edit.undo": { params: {} },
  "command.edit.redo": { params: {} },
  "command.edit.cut": { params: {} },
  "command.edit.copy": { params: {} },
  "command.edit.paste": { params: {} },
  "command.edit.selectAll": { params: {} },
  "command.link.documentation": { params: {} },
  "command.link.report": { params: {} },
  "command.version.copy": { params: {} },
  "command.about.open": { params: {} },
  "menu.file": { params: {} },
  "menu.edit": { params: {} },
  "menu.view": { params: {} },
  "menu.help": { params: {} },
  "menu.theme": { params: {} },
  "menu.services": { params: {} },
  "menu.hide": { params: {} },
  "menu.hideOthers": { params: {} },
  "menu.showAll": { params: {} },
  "dialog.close": { params: {} },
  "about.version": { params: {} },
  "about.build": { params: {} },
  "about.system": { params: {} },
  "about.repository": { params: {} },
  "about.external": { params: {} },
  "about.notices": { params: {} },
  "about.copied": { params: {} },
  "help.language": { params: {} },
  "help.appearance": { params: {} },
  "help.zoom": { params: {} },
  "help.characters": { params: {} },
  "help.layout": { params: {} },
  "command.failed": { params: {} },
  "about.loadFailed": { params: {} },
  "about.copyFailed": { params: {} },
  "about.description": { params: {} },
  "command.reason.handler_missing": { params: {} },
  "command.reason.modal_open": { params: {} },
  "command.reason.composing": { params: {} },
  "command.reason.no_edit_target": { params: {} },
  "command.reason.busy": { params: {} },
  "command.reason.zoom_minimum": { params: {} },
  "command.reason.zoom_maximum": { params: {} },
  "command.reason.actual_size": { params: {} },
  "command.reason.last_panel": { params: {} },
  "command.reason.window_limit": { params: {} },
  "help.capabilities": { params: {} },
  "help.language.text": { params: {} },
  "help.appearance.text": { params: {} },
  "help.zoom.text": { params: {} },
  "help.characters.text": { params: {} },
  "help.layout.text": { params: {} },
  "menu.application": { params: {} },
  "about.platform.win32": { params: {} },
  "about.platform.darwin": { params: {} },
  "about.platform.linux": { params: {} },

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
  readonly [
    P in keyof (typeof messageContracts)[K]["params"]
  ]: (typeof messageContracts)[K]["params"][P] extends "number" ? number : string;
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
  const parameters: Record<string, string | number> = args.length ? args[0] : {};
  const expected = Object.keys(messageContracts[key].params);
  if (
    Object.keys(parameters).length !== expected.length ||
    expected.some(
      (name) =>
        typeof parameters[name] !== (messageContracts[key].params as Record<string, string>)[name],
    )
  )
    throw new Error("Invalid message parameters.");
  const contract = messageContracts[key];
  if ("forms" in contract) {
    for (const name of Object.keys(contract.forms)) {
      const count = parameters[name];
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
        throw new Error("Invalid plural parameters.");
    }
  }
  return renderMessage(locale, template, parameters, "forms" in contract ? contract.forms : {});
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

/** Plain text, typed interpolation and named cardinal selectors, including nested counts. */
function renderMessage(
  locale: InterfaceLocale,
  template: string,
  parameters: Readonly<Record<string, string | number>>,
  forms: Readonly<Record<string, { readonly kind: "plural" }>>,
  pound?: number,
): string {
  let result = "";
  let offset = 0;
  while (offset < template.length) {
    const char = template[offset] ?? "";
    if (char === "}") throw new Error("Unbalanced message.");
    if (char !== "{") {
      result += char === "#" && pound !== undefined ? formatNumber(locale, pound) : char;
      offset++;
      continue;
    }
    const start = offset;
    let depth = 1;
    while (++offset < template.length && depth) {
      if (template[offset] === "{") depth++;
      if (template[offset] === "}") depth--;
    }
    if (depth) throw new Error("Unbalanced message.");
    const body = template.slice(start + 1, offset - 1);
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(body)) {
      const value = parameters[body];
      if (value === undefined) throw new Error("Missing message parameter.");
      result += typeof value === "number" ? formatNumber(locale, value) : value;
      continue;
    }
    const selector = /^([A-Za-z][A-Za-z0-9_]*), plural,\s*/.exec(body);
    if (!selector?.[1] || !forms[selector[1]]) throw new Error("Unsupported plural message.");
    const count = parameters[selector[1]];
    if (typeof count !== "number") throw new Error("Invalid plural parameters.");
    const options = new Map<string, string>();
    let cursor = selector[0].length;
    while (cursor < body.length) {
      const option = /^(zero|one|two|few|many|other|=\d+)\s*\{/.exec(body.slice(cursor));
      if (!option?.[1]) throw new Error("Invalid plural form.");
      cursor += option[0].length;
      const content = cursor;
      let nesting = 1;
      while (cursor < body.length && nesting) {
        if (body[cursor] === "{") nesting++;
        if (body[cursor] === "}") nesting--;
        cursor++;
      }
      if (nesting || options.has(option[1])) throw new Error("Invalid plural form.");
      options.set(option[1], body.slice(content, cursor - 1));
      while (/\s/.test(body[cursor] ?? "") && cursor < body.length) cursor++;
    }
    const selected =
      options.get(`=${String(count)}`) ??
      options.get(new Intl.PluralRules(locale).select(count)) ??
      options.get("other");
    if (selected === undefined) throw new Error("Missing plural form.");
    result += renderMessage(locale, selected, parameters, forms, count);
  }
  return result;
}
