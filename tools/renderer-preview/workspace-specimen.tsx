import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Workspace, CommandController, Dialog, Tabs, TextField } from "@ohtia/renderer";
import { catalogs, type InterfaceLocale } from "../../packages/contracts/dist/index.js";
type Port = Parameters<typeof Workspace>[0]["port"];
type Bridge = Parameters<typeof Workspace>[0]["commandBridge"];
const call = <T,>(value: T) => ({ result: Promise.resolve(value), cancel() {} });

/** The separate catalog owns all synthetic transport/data. No product fixture switch exists. */
export function WorkspaceSpecimen() {
  const params = new URLSearchParams(location.search);
  const locale = (params.get("locale") ?? "en-US") as InterfaceLocale;
  useMemo(() => {
    if (params.has("expanded")) {
      const messages = catalogs[locale].messages as Record<string, string>;
      for (const [key, value] of Object.entries(messages))
        messages[key] = `${value} ${"x".repeat(Math.ceil(value.length * 0.4))}`;
    }
  }, []);
  const [notice, setNotice] = useState<string>();
  const [saved, setSaved] = useState(0);
  const [zoom, setZoom] = useState(Number(params.get("zoom") ?? 100));
  const [zoomIntents, setZoomIntents] = useState(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const registryRef = useRef<CommandController | undefined>(undefined);
  useLayoutEffect(() => registryRef.current?.changed(), [zoom]);
  useEffect(() => {
    // Catalog-only transport: invoke the registry without moving the focused DOM control.
    const reset = () => {
      void registryRef.current?.invoke("layout.reset");
    };
    document.addEventListener("synthetic:layout-reset", reset);
    return () => document.removeEventListener("synthetic:layout-reset", reset);
  }, []);
  const synthetic = useMemo(() => {
    let revision = 0;
    const port = {
      readLayout: () =>
        call({
          ok: true,
          value: { schemaVersion: 1, source: "missing", revision: 0, value: null },
        }),
      replaceLayout: () => {
        setSaved((value) => value + 1);
        return call({
          ok: false,
          error: {
            code: params.has("uncertain") ? "uncertain" : "service_unavailable",
            parameters: {},
          },
        });
      },
      readLayoutReceipt: () => call({ ok: true, value: { state: "not_found" } }),
      claimLayoutFailureNotice: () => call({ ok: true, value: { announce: revision++ === 0 } }),
    } as unknown as Port;
    const bridge: Bridge = {
      context: async () => ({
        windowGeneration: "synthetic-workspace",
        platform: params.get("platform") === "darwin" ? "darwin" : "linux",
      }),
      publish: async () => !params.has("publishFails"),
      onIntent: () => () => {},
      about: async () => {
        throw new Error("Synthetic unavailable About metadata");
      },
      copyVersionInformation: async () => false,
      openLink: async () => false,
      windowAction: async () => ({ status: "unavailable", reason: "handler_missing" }),
      perform: async () => false,
    };
    return { port, bridge };
  }, []);
  const register = useMemo(
    () => (registry: CommandController) => {
      const stops = (["settings.open", "shortcuts.open", "help.open"] as const)
        .filter((id) => id !== "help.open")
        .map((id) =>
          registry.register(id, {
            state: () => (document.querySelector("dialog[open]") ? { reason: "modal_open" } : {}),
            run: () => {
              setNotice(id);
              return true;
            },
          }),
        );
      registryRef.current = registry;
      stops.push(
        registry.register("zoom.reset", {
          state: () => (zoomRef.current === 100 ? { reason: "actual_size" } : {}),
          run: () => {
            setZoomIntents((value) => value + 1);
            setZoom(100);
            return true;
          },
        }),
      );
      return () => {
        registryRef.current = undefined;
        stops.forEach((stop) => stop());
      };
    },
    [],
  );
  const theme = params.get("theme") ?? "light";
  document.documentElement.dataset.appearance = theme;
  document.documentElement.lang = locale;
  return (
    <>
      <Workspace
        port={synthetic.port}
        commandBridge={synthetic.bridge}
        registerHandlers={register}
        locale={locale}
        decoration={params.has("hidden") ? "hidden" : "static"}
        zoom={zoom}
        windowInsets={{
          start: Number(params.get("start") ?? 0),
          end: Number(params.get("end") ?? 0),
        }}
      />
      <Dialog
        open={!!notice}
        title="Synthetic command destination"
        closeLabel="Close synthetic destination"
        onClose={() => setNotice(undefined)}
      >
        <p>{notice}</p>
      </Dialog>
      <output
        hidden
        data-synthetic-saved={saved > 0}
        data-synthetic-saves={saved}
        data-synthetic-zoom-intents={zoomIntents}
      />
    </>
  );
}

/** Scoped A→B→A selections have separate incarnations even when a stable resource is revisited. */
export function ScopedWorkspaceSpecimen() {
  const [scope, setScope] = useState({ id: "A", incarnation: 0, selectionRevision: 0 });
  const [tab, setTab] = useState("navigator");
  const [buffers, setBuffers] = useState<Record<string, string>>({
    A: "Synthetic manuscript buffer A",
    B: "Synthetic manuscript buffer B",
  });
  const [selection, setSelection] = useState("original");
  const pending = useMemo(() => new Set<ReturnType<typeof setTimeout>>(), []);
  const current = useMemo(() => ({ scope, live: true }), []);
  current.scope = scope;
  useEffect(
    () => () => {
      current.live = false;
      pending.forEach(clearTimeout);
      pending.clear();
    },
    [current, pending],
  );
  // This catalog intentionally keeps buffers in mounted tab content; it implements no project port.
  return (
    <main>
      <h1>Synthetic scoped presentation</h1>
      <button
        type="button"
        onClick={() =>
          setScope((s) => ({
            id: s.id === "A" ? "B" : "A",
            incarnation: s.incarnation + 1,
            selectionRevision: s.selectionRevision + 1,
          }))
        }
      >
        Switch synthetic scope
      </button>
      <button
        type="button"
        onClick={() => {
          const captured = current.scope;
          const timer = setTimeout(() => {
            pending.delete(timer);
            if (current.live && current.scope === captured) setSelection(`late ${captured.id}`);
          }, 100);
          pending.add(timer);
        }}
      >
        Delayed selection
      </button>
      <p>
        Scope {scope.id}, incarnation {scope.incarnation}, selection {selection}
      </p>
      <Tabs
        label="Synthetic documents"
        selected={tab}
        onSelect={setTab}
        items={[
          { id: "navigator", label: "Navigator", content: <p>Synthetic navigator</p> },
          {
            id: "draft",
            label: "Synthetic draft",
            content: (
              <TextField
                id="synthetic-draft"
                label="Synthetic buffer"
                value={buffers[scope.id] ?? ""}
                onChange={(value) => setBuffers((previous) => ({ ...previous, [scope.id]: value }))}
                onValidate={() => {}}
              />
            ),
          },
        ]}
      />
      <button
        type="button"
        onClick={() => {
          current.live = false;
          pending.forEach(clearTimeout);
          pending.clear();
        }}
      >
        Dispose synthetic view
      </button>
    </main>
  );
}
