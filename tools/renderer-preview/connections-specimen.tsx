import { useMemo } from "react";
import {
  openrouterConnection,
  type ConnectionSnapshot,
  type FoundationPort,
  type InterfaceLocale,
} from "../../packages/contracts/dist/index.js";
import { ConnectionsPanel } from "../../packages/renderer/src/connections-panel.js";
import "../../packages/renderer/src/primitives.css";
import "../../packages/renderer/src/settings.css";

const base = {
  connection: openrouterConnection.id,
  display_name: openrouterConnection.displayName,
  account_email: null,
  last_account_email: null,
  probing: false,
  probe_id: null,
  model_list_revision: null,
  model_count: 0,
} as const;
/** The OpenRouter group's row states, with no main process, credential or network. */
const cases: readonly ConnectionSnapshot[] = [
  { ...base, state: "disconnected", reason: null },
  {
    ...base,
    state: "connected",
    reason: null,
    connected_at: "2026-11-26T10:00:00.000Z",
    expires_at: "2026-12-03T10:00:00.000Z",
    model_list_revision: 1,
    model_count: 2,
  },
  {
    ...base,
    state: "connected",
    reason: null,
    connected_at: "2026-11-26T10:00:00.000Z",
    model_list_revision: 1,
    model_count: 2,
  },
  { ...base, state: "expired", reason: null },
  {
    ...base,
    state: "connected",
    reason: null,
    signing_in: true,
    connected_at: "2026-11-26T10:00:00.000Z",
    expires_at: "2026-12-03T10:00:00.000Z",
    model_list_revision: 1,
    model_count: 2,
  },
  { ...base, state: "disconnected", reason: "sign_in_rejected", unkept_key: true },
];
function port(snapshot: ConnectionSnapshot): FoundationPort {
  const call = <T,>(value: T) => ({
    result: Promise.resolve({ ok: true as const, value }),
    cancel() {},
  });
  return {
    readConnection: () => call(snapshot),
    subscribeConnection: () => ({
      ready: Promise.resolve({ ok: true as const, value: { subscriptionId: "specimen" } }),
      dispose() {},
    }),
  } as unknown as FoundationPort;
}
export function ConnectionsSpecimen() {
  const params = new URLSearchParams(location.search);
  const locale = (params.get("locale") ?? "en-US") as InterfaceLocale;
  useMemo(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.appearance = params.get("theme") ?? "light";
  }, []);
  const width = Number(params.get("width") ?? 560);
  return (
    <main className="connections-specimen" style={{ inlineSize: `${width}px`, padding: "16px" }}>
      {cases.map((snapshot, index) => (
        <section key={index} data-case={index} aria-label={`${snapshot.state} ${index}`}>
          <h3>{openrouterConnection.displayName}</h3>
          <ConnectionsPanel
            port={port(snapshot)}
            locale={locale}
            available
            connection={openrouterConnection.id}
            kind="api_key"
            embedded
            openLink={() => {}}
          />
        </section>
      ))}
    </main>
  );
}
