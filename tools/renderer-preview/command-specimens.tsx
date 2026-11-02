import { useMemo, useState } from "react";
import { CommandSurfaces } from "@ohtia/renderer";
type CommandBridge = Parameters<typeof CommandSurfaces>[0]["bridge"];
type InterfaceLocale = Parameters<typeof CommandSurfaces>[0]["locale"];

/** Development-only controlled data. No broker, clipboard, storage or browser launch is used. */
export function CommandSpecimens() {
  const [locale, setLocale] = useState<InterfaceLocale>("en-US");
  const [hidden, setHidden] = useState(false);
  const [copyFails, setCopyFails] = useState(false);
  const bridge = useMemo<CommandBridge>(
    () => ({
      context: async () => ({ windowGeneration: "catalog-command-window", platform: "linux" }),
      publish: async () => true,
      onIntent: () => () => {},
      about: async () => ({
        product: "Ohtia",
        version: "0.0.0-dev.1.1",
        build: `sha256:${"a".repeat(64)}`,
        platform: "linux",
        architecture: "x86-64",
        copyright: "Copyright (c) 2026 Adrian Mastronardi & Mónica Pené",
        license:
          "MIT License — synthetic catalog content; the installed dialog reads its bundled notice.",
        notices: [
          { component: "IBM Plex Sans", license: "OFL-1.1" },
          { component: "Noto Sans KR", license: "OFL-1.1" },
          { component: "React", license: "MIT" },
        ],
      }),
      perform: async () => true,
      copyVersionInformation: async () => !copyFails,
      openLink: async () => false,
    }),
    [copyFails],
  );
  return (
    <section aria-label="Command surface specimens">
      <h2>Local Help and About — synthetic presentation</h2>
      <label>
        Command specimen language{" "}
        <select
          value={locale}
          onChange={(event) => {
            setLocale(event.currentTarget.value as InterfaceLocale);
          }}
        >
          {(["en-US", "es-AR", "de-DE", "fi-FI", "ko-KR"] as const).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={hidden}
          onChange={(event) => {
            setHidden(event.currentTarget.checked);
          }}
        />
        Hide About character
      </label>
      <label>
        <input
          type="checkbox"
          checked={copyFails}
          onChange={(event) => {
            setCopyFails(event.currentTarget.checked);
          }}
        />
        Simulate copy failure
      </label>
      <p>
        Commands, metadata, copy results and links below are synthetic and unsaved. No system
        clipboard or external browser is used.
      </p>
      <CommandSurfaces bridge={bridge} locale={locale} decoration={hidden ? "hidden" : "static"} />
    </section>
  );
}
