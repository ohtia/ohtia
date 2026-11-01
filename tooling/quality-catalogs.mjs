import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { requireGate, sameSet } from "./quality-core.mjs";

/** Validate authored ICU messages against a typed contract, never a fallback catalog. */
export function catalogGate(locales, contracts, catalogs) {
  requireGate(
    locales.length > 0 && Object.keys(contracts).length > 0,
    "empty locale/message contract",
  );
  sameSet(Object.keys(catalogs), locales, "locale inventory");
  for (const locale of locales) {
    requireGate(Intl.getCanonicalLocales(locale)[0] === locale, `noncanonical locale: ${locale}`);
    const catalog = catalogs[locale];
    requireGate(
      catalog?.version === 1 && catalog.locale === locale,
      `${locale}: wrong catalog identity/version`,
    );
    sameSet(Object.keys(catalog.messages ?? {}), Object.keys(contracts), `${locale}: message keys`);
    for (const [key, contract] of Object.entries(contracts)) {
      const text = catalog.messages[key];
      requireGate(
        typeof text === "string" && text.trim().length > 0,
        `${locale}/${key}: empty message`,
      );
      requireGate(
        Object.values(contract.params).every((type) => ["string", "number", "date"].includes(type)),
        `${locale}/${key}: unsupported parameter type`,
      );
      const params = new Map(),
        forms = new Map();
      function parameter(name, type) {
        requireGate(
          !params.has(name) || params.get(name) === type,
          `${locale}/${key}: conflicting parameter types`,
        );
        params.set(name, type);
      }
      function inspect(nodes, plural = false) {
        for (const node of nodes) {
          if (node.type === TYPE.literal) continue;
          if (node.type === TYPE.pound) {
            requireGate(plural, `${locale}/${key}: pound outside plural`);
            continue;
          }
          requireGate(node.type !== TYPE.tag, `${locale}/${key}: markup is not admitted`);
          if ([TYPE.argument, TYPE.number, TYPE.date, TYPE.time].includes(node.type)) {
            parameter(
              node.value,
              node.type === TYPE.argument
                ? (contract.params[node.value] ?? "string")
                : node.type === TYPE.number
                  ? "number"
                  : "date",
            );
          } else if (node.type === TYPE.select || node.type === TYPE.plural) {
            const kind =
              node.type === TYPE.select
                ? "select"
                : node.pluralType === "ordinal"
                  ? "selectordinal"
                  : "plural";
            parameter(node.value, kind === "select" ? "string" : "number");
            const spec = contract.forms?.[node.value];
            requireGate(spec?.kind === kind, `${locale}/${key}: unexpected plural/select form`);
            const options = Object.keys(node.options);
            requireGate(options.includes("other"), `${locale}/${key}: missing other form`);
            if (kind === "select")
              sameSet(options, spec.options, `${locale}/${key}: select options`);
            else {
              const categories = new Intl.PluralRules(locale, {
                type: kind === "plural" ? "cardinal" : "ordinal",
              }).resolvedOptions().pluralCategories;
              requireGate(
                options.every((option) => categories.includes(option) || /^=\d+$/.test(option)),
                `${locale}/${key}: invalid plural category`,
              );
              requireGate(
                categories.every((category) => options.includes(category)),
                `${locale}/${key}: missing required plural category`,
              );
              requireGate(
                (node.offset ?? 0) === 0,
                `${locale}/${key}: plural offsets are not admitted`,
              );
            }
            forms.set(node.value, kind);
            for (const option of Object.values(node.options))
              inspect(option.value, kind !== "select" || plural);
          } else throw new Error(`Quality gate: ${locale}/${key}: unsupported message syntax`);
        }
      }
      inspect(parse(text, { requiresOtherClause: true, ignoreTag: false }));
      sameSet([...params.keys()], Object.keys(contract.params), `${locale}/${key}: parameters`);
      for (const [name, type] of params)
        requireGate(contract.params[name] === type, `${locale}/${key}: parameter ${name} type`);
      sameSet([...forms.keys()], Object.keys(contract.forms ?? {}), `${locale}/${key}: forms`);
    }
  }
  return { status: "passed", locales: locales.length, messages: Object.keys(contracts).length };
}
