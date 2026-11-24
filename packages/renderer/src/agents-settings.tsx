import { RecoveryFocusBoundary } from "./settings-notices.js";
import { contributorNames, VoiceLabel } from "./contributor-identity.js";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  agentPreferenceTargets,
  formatDate,
  openaiApiKeyConnection,
  openaiCatalogCheckedOn,
  message,
  type AgentPreferences,
  type AgentPreferenceTarget,
  type ConnectionSnapshot,
  type ConnectionEvent,
  type FoundationPort,
  type InterfaceLocale,
  type ProviderDeclaration,
  type ProviderModel,
  type ReplaceAgentPreference,
} from "@ohtia/contracts";
import { LucideGlyph as Icon } from "./iconography.js";

type Service = ProviderDeclaration["connection"];
export type AgentSettingsObserver = (
  listener: (target?: AgentPreferenceTarget, revision?: number) => void,
) => () => void;
type EffectiveChoice = Pick<ReplaceAgentPreference, "connection" | "model" | "inherit" | "effort">;

type ExternalChange = {
  field: "service" | "model" | "effort";
  choice: EffectiveChoice;
  modelName: string | null;
};
type SaveLabel = { setting: string; value: string; previous?: string };
type SaveState = SaveLabel & {
  target: AgentPreferenceTarget;
  phase: "saving" | "saved" | "rejected" | "conflict" | "uncertain";
};

export function useAgentSettings(
  port: FoundationPort,
  active: boolean,
  observe?: AgentSettingsObserver,
) {
  const [data, setData] = useState<AgentPreferences>();
  const previous = useRef<AgentPreferences | undefined>(undefined);
  const [external, setExternal] = useState<
    Partial<Record<AgentPreferenceTarget, ExternalChange | undefined>>
  >({});
  const notified = useRef(new Map<AgentPreferenceTarget, number>());
  const [failed, setFailed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>();
  const [pendingChoice, setPendingChoice] = useState<ReplaceAgentPreference>();
  const unconfirmed = useRef<
    { operationId: string; choice: ReplaceAgentPreference; label: SaveLabel } | undefined
  >(undefined);

  const lastIntent = useRef<{ choice: ReplaceAgentPreference; label: SaveLabel } | undefined>(
    undefined,
  );
  const acknowledged = useRef<ReplaceAgentPreference | undefined>(undefined);
  const request = useRef(0);
  const latestRead = useRef<Promise<AgentPreferences | undefined> | undefined>(undefined);
  const saving = useRef<AgentPreferenceTarget | undefined>(undefined);
  const ownRevisions = useRef(new Map<AgentPreferenceTarget, ReplaceAgentPreference>());
  const live = useRef(false);
  const read = useCallback(
    (target?: AgentPreferenceTarget, revision?: number) => {
      if (target && revision !== undefined) notified.current.set(target, revision);
      const attempt = async () => {
        const version = ++request.current;
        const pending = unconfirmed.current;
        const result = await port.listAgentPreferences(pending?.operationId).result;
        if (!live.current || version !== request.current) return undefined;
        if (result.ok) {
          if (pending && result.value.receipt === "not_found")
            ownRevisions.current.delete(pending.choice.target);
          const confirmed = acknowledged.current;
          const observations = new Map<AgentPreferenceTarget, number | null>(notified.current);
          // Receipt and save recovery can observe a row without an externally attributable write.
          if (pending && !observations.has(pending.choice.target))
            observations.set(pending.choice.target, null);
          if (confirmed && !observations.has(confirmed.target))
            observations.set(confirmed.target, null);
          const changes: Partial<Record<AgentPreferenceTarget, ExternalChange>> = {};
          for (const [observed, reportedRevision] of observations) {
            const previousRow = preference(previous.current, observed);
            const currentRow = preference(result.value, observed);
            const own = ownRevisions.current.get(observed);
            const ownRevision = own ? own.expectedRevision + 1 : 0;
            const revision = currentRow?.revision ?? 0;
            if (own && revision === ownRevision) ownRevisions.current.delete(observed);
            else if (
              previous.current &&
              reportedRevision === revision &&
              revision !== (previousRow?.revision ?? 0) &&
              (saving.current !== observed || revision > ownRevision)
            ) {
              const confirmedOwn =
                acknowledged.current === own ||
                (pending?.choice === own && result.value.receipt === "recorded");
              const prior = effectiveChoice(
                previous.current,
                observed,
                confirmedOwn ? own : undefined,
              );
              const current = effectiveChoice(result.value, observed);
              ownRevisions.current.delete(observed);
              const commonInheritance = prior.inherit && current.inherit;
              const field =
                !commonInheritance &&
                !(current.inherit && current.connection === null) &&
                prior.connection !== current.connection
                  ? "service"
                  : !commonInheritance &&
                      (prior.model !== current.model || prior.inherit !== current.inherit)
                    ? "model"
                    : prior.effort !== current.effort
                      ? "effort"
                      : undefined;
              if (field) {
                const model = current.inherit ? preference(result.value, "default") : currentRow;
                changes[observed] = { field, choice: current, modelName: model?.modelName ?? null };
              }
            }
          }
          notified.current.clear();
          const before = previous.current;
          setExternal((existing) => {
            const next = { ...existing, ...changes };
            for (const target of agentPreferenceTargets) {
              if (!existing[target] || changes[target]) continue;
              if (
                preference(before, target)?.revision !== preference(result.value, target)?.revision
              )
                next[target] = undefined;
            }
            return next;
          });
          previous.current = result.value;
          setData(result.value);
          if (
            confirmed &&
            (preference(result.value, confirmed.target)?.revision ?? 0) > confirmed.expectedRevision
          ) {
            acknowledged.current = undefined;
            if (!saving.current) setPendingChoice(undefined);
          }
          if (
            !saving.current &&
            pending &&
            unconfirmed.current === pending &&
            result.value.receipt
          ) {
            const { choice, label } = pending;
            if (result.value.receipt === "not_found") ownRevisions.current.delete(choice.target);
            unconfirmed.current = undefined;
            setPendingChoice(undefined);
            setSaveState({
              ...label,
              target: choice.target,
              phase: result.value.receipt === "recorded" ? "saved" : "rejected",
            });
          }
        }
        setFailed(!result.ok);
        return result.ok ? result.value : undefined;
      };
      const pending = attempt();
      latestRead.current = pending;
      return pending;
    },
    [port],
  );
  useEffect(() => {
    if (!active || typeof port.listAgentPreferences !== "function") return;
    live.current = true;
    const stop = observe?.((target, revision) => {
      void read(target, revision);
    });
    void read();
    return () => {
      live.current = false;
      request.current++;
      latestRead.current = undefined;
      notified.current.clear();
      setExternal({});
      stop?.();
    };
  }, [active, observe, port, read]);
  const save = async (choice: ReplaceAgentPreference, label: SaveLabel) => {
    if (saving.current || unconfirmed.current || acknowledged.current) return false;
    saving.current = choice.target;
    lastIntent.current = { choice, label };
    ownRevisions.current.set(choice.target, choice);
    setExternal({});
    setPendingChoice(choice);
    const operationId = crypto.randomUUID();
    setSaveState({ ...label, target: choice.target, phase: "saving" });
    try {
      const result = await port.replaceAgentPreference(operationId, choice).result;
      const phase = result.ok
        ? "saved"
        : result.error.code === "stale_revision"
          ? "conflict"
          : ["uncertain", "service_unavailable", "timeout"].includes(result.error.code)
            ? "uncertain"
            : "rejected";
      if (phase === "rejected" || phase === "conflict") ownRevisions.current.delete(choice.target);
      if (phase === "saved") acknowledged.current = choice;
      if (phase === "uncertain") unconfirmed.current = { operationId, choice, label };
      if (phase === "uncertain") setSaveState({ ...label, target: choice.target, phase });
      let pending = live.current ? read() : undefined;
      let current: AgentPreferences | undefined;
      while (pending) {
        current = await pending;
        if (pending === latestRead.current) break;
        pending = latestRead.current;
      }
      if (phase === "uncertain" && current?.receipt) {
        if (current.receipt === "not_found") ownRevisions.current.delete(choice.target);
        unconfirmed.current = undefined;
        setSaveState({
          ...label,
          target: choice.target,
          phase: current.receipt === "recorded" ? "saved" : "rejected",
        });
      } else if (phase !== "uncertain") {
        setSaveState({ ...label, target: choice.target, phase });
      }
      return result.ok || current?.receipt === "recorded";
    } finally {
      saving.current = undefined;
      if (!unconfirmed.current && !acknowledged.current) setPendingChoice(undefined);
    }
  };
  const retry = () => {
    const intent = lastIntent.current;
    if (intent && saveState?.phase === "rejected") void save(intent.choice, intent.label);
  };
  const chooseAgain = () => {
    setSaveState(undefined);
  };
  return { data, failed, read, save, retry, chooseAgain, saveState, pendingChoice, external };
}
type Settings = ReturnType<typeof useAgentSettings>;

function SaveFeedback({
  state,
  locale,
  onCheck,
  onRetry,
  onChoose,
}: {
  state: SaveState | undefined;
  locale: InterfaceLocale;
  onCheck?: () => void;
  onRetry?: () => void;
  onChoose?: () => void;
}) {
  if (!state) return null;
  const { setting, previous, phase } = state;
  const action = phase === "rejected" ? onRetry : phase === "conflict" ? onChoose : onCheck;
  if (phase === "saving" || phase === "saved")
    return (
      <p className="settings-save-state" role="status">
        <Icon name={phase === "saved" ? "check" : "circle-dashed"} />
        {message(locale, phase)}
      </p>
    );
  return (
    <div className="agent-choice-feedback">
      <p
        className={
          phase === "rejected"
            ? "connection-notice connection-danger"
            : "connection-notice connection-attention"
        }
        role={phase === "rejected" ? "alert" : "status"}
        data-settings-attention={
          phase === "rejected"
            ? "octagon-alert"
            : phase === "conflict"
              ? "git-compare"
              : "triangle-alert"
        }
      >
        <Icon
          name={
            phase === "rejected"
              ? "octagon-alert"
              : phase === "conflict"
                ? "git-compare"
                : "triangle-alert"
          }
        />
        {phase === "rejected"
          ? message(locale, "settings.rejected", {
              setting,
              value: previous ?? message(locale, "agents.chooseModel"),
            })
          : message(locale, phase === "conflict" ? "settings.conflict" : "settings.uncertain", {
              setting,
            })}
      </p>
      {action && (
        <button type="button" className="primitive-button" onClick={action}>
          {message(
            locale,
            phase === "rejected"
              ? "settings.language.tryAgain"
              : phase === "conflict"
                ? "settings.language.chooseAgain"
                : "workspace.check",
          )}
        </button>
      )}
    </div>
  );
}

function useModels(
  port: FoundationPort,
  connection: string | undefined,
  revision: number | undefined,
  account: string | undefined,
) {
  const [list, setList] = useState<{
    connection: string;
    revision: number;
    account: string | undefined;
    models: readonly ProviderModel[];
  }>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setFailed(false);
    if (!connection || !revision) return;
    let live = true;
    const reading = () => live;
    let call: ReturnType<FoundationPort["listProviderModels"]> | undefined;
    const load = async () => {
      let current = revision;
      let cursor = 0;
      const models: ProviderModel[] = [];
      while (reading()) {
        call = port.listProviderModels({ connection, list_revision: current, cursor, count: 128 });
        const page = await call.result;
        if (!reading()) return;
        if (!page.ok) {
          const newer =
            page.error.code === "stale_revision" && page.error.parameters.currentRevision;
          if (!newer || newer <= current) {
            setFailed(true);
            return;
          }
          current = newer;
          cursor = 0;
          models.length = 0;
          continue;
        }
        if (
          page.value.connection !== connection ||
          page.value.list_revision !== current ||
          page.value.nextCursor !== cursor + page.value.models.length
        )
          return;
        models.push(...page.value.models);
        if (!page.value.hasMore) {
          setList({ connection, revision: current, account, models });
          return;
        }
        if (page.value.nextCursor <= cursor) return;
        cursor = page.value.nextCursor;
      }
    };
    void load();
    return () => {
      live = false;
      call?.cancel();
    };
  }, [port, connection, revision, account, retry]);
  const matching =
    list && list.connection === connection && revision !== undefined && list.account === account;
  return {
    models: matching ? list.models : undefined,
    updating:
      !!connection && revision !== undefined && (!matching || list.revision < revision) && !failed,
    failed: !!connection && failed,
    retry: () => {
      setRetry((attempt) => attempt + 1);
    },
  };
}

const preference = (data: AgentPreferences | undefined, target: AgentPreferenceTarget) =>
  data?.preferences.find((row) => row.target === target);

function effectiveChoice(
  data: AgentPreferences | undefined,
  target: AgentPreferenceTarget,
  intent?: ReplaceAgentPreference,
): EffectiveChoice {
  const row = intent ?? preference(data, target);
  const inherit = target !== "default" && (row?.inherit ?? true);
  const model = inherit ? preference(data, "default") : row;
  return {
    connection: model?.connection ?? null,
    model: model?.model ?? null,
    inherit,
    effort: (row ? row.effort : model?.effort) ?? null,
  };
}

export function FirstModelChoice({
  snapshot,
  port,
  settings,
  locale,
  showConnected,
}: {
  readonly snapshot: ConnectionSnapshot;
  readonly port: FoundationPort;
  readonly settings: Settings;
  readonly locale: InterfaceLocale;
  readonly showConnected: boolean;
}) {
  const title = useId();
  const control = useRef<HTMLSelectElement>(null);
  const focus = useRef(false);
  const [selected, choose] = useState<string>();
  const saved = preference(settings.data, "default");
  const list = settings.data?.lists.find(
    (list) => list.connection === snapshot.connection && list.current !== false,
  );
  const canAsk =
    !!settings.data &&
    snapshot.state === "connected" &&
    !saved?.model &&
    !saved?.seedPending &&
    !!list?.count;
  const openaiCatalog = snapshot.connection === openaiApiKeyConnection.id;
  const now = useModelListClock(canAsk && openaiCatalog);
  const catalog = useModels(
    port,
    canAsk ? snapshot.connection : undefined,
    list?.list_revision,
    snapshot.account_revision,
  );
  const models = catalog.models;
  const model = models?.find((entry) => entry.id === selected) ?? models?.[0];
  useEffect(() => {
    if (!canAsk) {
      focus.current = false;
      return;
    }
    if (model && !focus.current) {
      focus.current = true;
      // A completing sign-in or catalog read must not commit a different field's draft by blur.
      if (
        document.activeElement?.matches(
          'input:not([type="checkbox"], [type="radio"]), textarea, [contenteditable="true"]',
        )
      )
        return;
      control.current?.focus();
    }
  }, [canAsk, model]);
  const recoverFocus = (content: ReactNode) => (
    <RecoveryFocusBoundary
      className="agent-focus-recovery"
      onRecover={(boundary) => {
        const row = boundary?.closest(".connection-row");
        (
          control.current ?? row?.querySelector<HTMLButtonElement>(".connection-actions button")
        )?.focus();
      }}
    >
      {content}
    </RecoveryFocusBoundary>
  );
  if (snapshot.state !== "connected") return recoverFocus(null);
  const locked =
    !!settings.pendingChoice ||
    settings.saveState?.phase === "saving" ||
    settings.saveState?.phase === "uncertain";
  if (canAsk && !model && catalog.failed)
    return recoverFocus(<CatalogReadFailure locale={locale} retry={catalog.retry} />);
  if (!canAsk || !model) {
    return recoverFocus(
      showConnected && saved?.model ? (
        <p className="connection-notice connection-info" role="status">
          <Icon name="info" />
          {message(locale, "agents.connected", { service: snapshot.display_name })}
        </p>
      ) : null,
    );
  }
  return recoverFocus(
    <div className="agent-choice" role="group" aria-labelledby={title}>
      <h4 id={title}>{message(locale, "agents.firstQuestion")}</h4>
      <label>
        {message(locale, "agents.model")}
        <select
          ref={control}
          aria-describedby={openaiCatalog ? title + "-catalog" : undefined}
          title={model.name}
          value={model.id}
          aria-disabled={locked || undefined}
          onChange={(event) => {
            if (!locked) choose(event.target.value);
          }}
        >
          {models?.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <small className="agent-model-name" aria-hidden="true">
          {model.name}
        </small>
      </label>
      {openaiCatalog && (
        <div id={title + "-catalog"}>
          <p>{message(locale, "agents.catalogUnlisted")}</p>
          <p>{catalogAge(locale, snapshot.display_name, list.updatedAt, now)}</p>
        </div>
      )}
      <button
        type="button"
        className="primitive-button primitive-primary"
        aria-disabled={locked || catalog.updating || undefined}
        onClick={() => {
          if (locked || catalog.updating) return;
          void settings.save(
            {
              target: "default",
              expectedRevision: saved?.revision ?? 0,
              connection: snapshot.connection,
              model: model.id,
              effort: null,
              inherit: false,
              source: "first_connection",
            },
            {
              setting: message(locale, "agents.default"),
              value: snapshot.display_name + " · " + model.name,
            },
          );
        }}
      >
        {message(locale, "agents.firstSave")}
      </button>
      {settings.failed && settings.pendingChoice?.target === "default" && (
        <CatalogReadFailure
          locale={locale}
          retry={() => {
            void settings.read();
          }}
        />
      )}
      {settings.saveState?.target === "default" && (
        <SaveFeedback
          state={settings.saveState}
          locale={locale}
          onCheck={() => {
            void settings.read();
          }}
          onRetry={settings.retry}
          onChoose={() => {
            settings.chooseAgain();
            control.current?.focus();
          }}
        />
      )}
    </div>,
  );
}

function CatalogReadFailure({ locale, retry }: { locale: InterfaceLocale; retry: () => void }) {
  return (
    <div className="agent-choice-feedback">
      <p
        className="connection-notice connection-attention"
        role="status"
        data-settings-attention="triangle-alert"
      >
        <Icon name="triangle-alert" />
        {message(locale, "settings.readFailed")}
      </p>
      <button type="button" className="primitive-button" onClick={retry}>
        {message(locale, "retry")}
      </button>
    </div>
  );
}

function serviceLabel(
  service: Service,
  snapshot: ConnectionSnapshot | undefined,
  locale: InterfaceLocale,
) {
  return service.kind === "api_key"
    ? message(locale, "agents.apiKey", { service: service.displayName })
    : snapshot?.account_email
      ? service.displayName + " · " + snapshot.account_email
      : service.displayName;
}
function relativeAge(locale: InterfaceLocale, value: string, now: number): string {
  const seconds = -Math.max(0, (now - Date.parse(value)) / 1000);
  const unit =
    seconds > -60 ? "second" : seconds > -3600 ? "minute" : seconds > -86400 ? "hour" : "day";
  const divisor = { second: 1, minute: 60, hour: 3600, day: 86400 }[unit];
  return new Intl.RelativeTimeFormat(locale, { style: "short" }).format(
    Math.trunc(seconds / divisor),
    unit,
  );
}
function PreferenceControls({
  target,
  settings,
  port,
  locale,
  connections,
  snapshots,
}: {
  readonly target: AgentPreferenceTarget;
  readonly settings: Settings;
  readonly port: FoundationPort;
  readonly locale: InterfaceLocale;
  readonly connections: readonly Service[];
  readonly snapshots: Readonly<Record<string, ConnectionSnapshot | undefined>>;
}) {
  const id = useId();
  const [serviceDraft, setDraft] = useState<string>();
  const row = preference(settings.data, target);
  const defaults = preference(settings.data, "default");
  const inherits = target !== "default" && (row?.inherit ?? true);
  const saved = inherits ? defaults : row;
  const draft = serviceDraft === saved?.connection ? undefined : serviceDraft;
  useEffect(() => {
    if (serviceDraft !== undefined && serviceDraft === saved?.connection) setDraft(undefined);
  }, [saved?.connection, serviceDraft]);
  const pending = settings.pendingChoice?.target === target ? settings.pendingChoice : undefined;
  const connection = pending
    ? ((pending.inherit ? defaults?.connection : pending.connection) ?? "")
    : (draft ?? saved?.connection ?? "");
  const service = connections.find((item) => item.id === connection);
  const defaultService = connections.find((item) => item.id === defaults?.connection);
  const revision = settings.data?.lists.find(
    (list) => list.connection === connection && list.current !== false,
  )?.list_revision;
  const connected = !!connection && snapshots[connection]?.state === "connected";
  const catalog = useModels(
    port,
    connected ? connection : undefined,
    revision,
    snapshots[connection]?.account_revision,
  );
  const models = catalog.models;
  const selected = pending
    ? pending.inherit
      ? defaults?.model
      : pending.model
    : draft
      ? undefined
      : saved?.model;
  const model = models?.find((entry) => entry.id === selected);
  const choosing = !selected;
  const name = target === "default" ? message(locale, "agents.default") : contributorNames[target];
  const inheritLabel =
    defaults?.modelName && defaultService
      ? message(locale, "agents.inherit", {
          service: defaultService.displayName,
          model: defaults.modelName,
        })
      : message(locale, "agents.useDefault");
  const currentModel =
    (pending?.inherit ?? (!draft && inherits)) && defaults?.connection === connection
      ? ":default"
      : (selected ?? "");
  const modelLabel =
    currentModel === ":default"
      ? inheritLabel
      : (model?.name ?? (draft ? undefined : (saved?.modelName ?? undefined)));
  const effort =
    (pending ? pending.effort : row ? row.effort : inherits ? defaults?.effort : null) ?? "";
  const effortReason = choosing
    ? message(locale, "agents.chooseFirst")
    : model?.effortSupport === "unsupported"
      ? message(locale, "agents.unsupported")
      : !model || model.effortSupport === "supported"
        ? undefined
        : message(locale, "agents.unknown");
  const disabled =
    !settings.data ||
    !!settings.pendingChoice ||
    catalog.updating ||
    settings.saveState?.phase === "saving" ||
    settings.saveState?.phase === "uncertain";
  const setChoice = async (
    entry: ProviderModel | undefined,
    inherit: boolean,
    nextEffort: string | null,
    field: "model" | "effort",
  ) => {
    if (!entry && !inherit) return;
    const applicableModel = inherit ? models?.find((item) => item.id === defaults?.model) : entry;
    if (
      nextEffort &&
      applicableModel &&
      !applicableModel.effortLevels?.some((level) => level.name === nextEffort && level.supported)
    )
      nextEffort = null;
    const changingService = draft !== undefined && draft !== saved?.connection;
    const setting =
      target === "default"
        ? name
        : message(
            locale,
            field === "effort"
              ? "agents.effortFor"
              : changingService
                ? "agents.serviceFor"
                : "agents.modelFor",
            { agent: name },
          );
    const value =
      target === "default"
        ? (service?.displayName ?? connection) + " · " + (entry?.name ?? "")
        : field === "effort"
          ? (nextEffort ?? message(locale, "agents.modelDefault"))
          : changingService && service
            ? serviceLabel(service, snapshots[connection], locale)
            : inherit
              ? inheritLabel
              : (entry?.name ?? "");
    const previousService = connections.find((item) => item.id === saved?.connection);
    const previous =
      target === "default" && previousService && saved?.modelName
        ? previousService.displayName + " · " + saved.modelName
        : field === "effort"
          ? effort || message(locale, "agents.modelDefault")
          : changingService && previousService
            ? serviceLabel(previousService, snapshots[previousService.id], locale)
            : inherits
              ? inheritLabel
              : saved?.modelName;
    if (
      await settings.save(
        {
          target,
          expectedRevision: row?.revision ?? 0,
          connection: inherit ? null : connection,
          model: inherit ? null : (entry?.id ?? null),
          effort: nextEffort,
          inherit,
          source: "researcher",
        },
        { setting, value, ...(previous ? { previous } : {}) },
      )
    )
      setDraft(undefined);
  };
  const external = settings.external[target];
  const externalSetting =
    target === "default"
      ? name
      : message(
          locale,
          external?.field === "service"
            ? "agents.serviceFor"
            : external?.field === "model"
              ? "agents.modelFor"
              : "agents.effortFor",
          { agent: name },
        );
  const externalService = connections.find((entry) => entry.id === external?.choice.connection);
  const externalModelName = external?.modelName ?? "";
  const externalValue =
    target === "default"
      ? (externalService?.displayName ?? external?.choice.connection ?? "") +
        " · " +
        externalModelName
      : external?.field === "service" && externalService
        ? serviceLabel(externalService, snapshots[externalService.id], locale)
        : external?.field === "model"
          ? external.choice.inherit
            ? externalService && externalModelName
              ? message(locale, "agents.inherit", {
                  service: externalService.displayName,
                  model: externalModelName,
                })
              : message(locale, "agents.useDefault")
            : externalModelName
          : (external?.choice.effort ?? message(locale, "agents.modelDefault"));
  const focusChoice = () => {
    const model = document.getElementById(id + "-model");
    const target = model?.matches(":disabled")
      ? model.closest(".agent-choice")?.querySelector<HTMLElement>("select:not(:disabled)")
      : model;
    target?.focus();
  };
  return (
    <div className="agent-choice" role="group" aria-labelledby={id}>
      <div className="agent-choice-heading">
        <h3 id={id}>
          {target === "default" ? (
            name
          ) : (
            <VoiceLabel
              identity={{ kind: "ai", contributor: target, definitionVersion: "1" }}
              locale={locale}
            />
          )}
        </h3>
        {settings.saveState?.target === target &&
          ["saving", "saved"].includes(settings.saveState.phase) && (
            <SaveFeedback state={settings.saveState} locale={locale} />
          )}
      </div>
      <label>
        {message(locale, "agents.service")}
        <select
          value={connection}
          aria-disabled={disabled || undefined}
          onChange={(event) => {
            if (disabled) return;
            const chosen = event.target.value;
            setDraft(chosen === saved?.connection ? undefined : chosen);
          }}
        >
          <option value="" disabled>
            {message(locale, "agents.chooseService")}
          </option>
          {connection && service && !connected && (
            <option value={connection} disabled>
              {service.displayName}
            </option>
          )}
          {connections
            .filter(({ id }) => snapshots[id]?.state === "connected")
            .map((item) => (
              <option key={item.id} value={item.id}>
                {serviceLabel(item, snapshots[item.id], locale)}
              </option>
            ))}
        </select>
      </label>
      <label>
        {message(locale, "agents.model")}
        <select
          id={id + "-model"}
          value={currentModel}
          title={modelLabel}
          aria-disabled={disabled || undefined}
          disabled={!models && target === "default"}
          onChange={(event) => {
            if (disabled) return;
            const picked = event.target.value;
            void setChoice(
              models?.find((item) => item.id === picked),
              picked === ":default",
              effort || null,
              "model",
            );
          }}
        >
          <option value="" disabled>
            {message(locale, "agents.chooseModel")}
          </option>
          {target !== "default" && (draft === undefined || defaults?.connection === connection) && (
            <option value=":default">{inheritLabel}</option>
          )}
          {currentModel && currentModel !== ":default" && !model && (
            <option value={currentModel} disabled>
              {saved?.modelName ?? currentModel}
            </option>
          )}
          {models?.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        {modelLabel && (
          <small className="agent-model-name" aria-hidden="true">
            {modelLabel}
          </small>
        )}
      </label>
      <label>
        {message(locale, "agents.effort")}
        <select
          value={effort}
          aria-disabled={disabled || undefined}
          disabled={!!effortReason || !model}
          aria-describedby={effortReason ? id + "-effort" : undefined}
          onChange={(event) => {
            if (disabled) return;
            void setChoice(model, inherits, event.target.value || null, "effort");
          }}
        >
          <option value="">{message(locale, "agents.modelDefault")}</option>
          {effort &&
            !model?.effortLevels?.some((level) => level.supported && level.name === effort) && (
              <option value={effort} disabled>
                {effort}
              </option>
            )}
          {model?.effortLevels
            ?.filter((level) => level.supported)
            .map((level) => (
              <option value={level.name} key={level.name}>
                {level.name}
              </option>
            ))}
        </select>
      </label>
      <RecoveryFocusBoundary className="agent-focus-recovery" onRecover={focusChoice}>
        {catalog.failed && <CatalogReadFailure locale={locale} retry={catalog.retry} />}
      </RecoveryFocusBoundary>
      {external && (
        <p className="connection-notice connection-info" role="status">
          <Icon name="info" />
          {message(locale, "settings.changed", { setting: externalSetting, value: externalValue })}
        </p>
      )}
      {effortReason && <small id={id + "-effort"}>{effortReason}</small>}
      <RecoveryFocusBoundary className="agent-focus-recovery" onRecover={focusChoice}>
        {settings.saveState?.target === target &&
          !["saving", "saved"].includes(settings.saveState.phase) && (
            <SaveFeedback
              state={settings.saveState}
              locale={locale}
              onRetry={settings.retry}
              onChoose={() => {
                settings.chooseAgain();
                focusChoice();
              }}
              onCheck={() => {
                void settings.read();
              }}
            />
          )}
      </RecoveryFocusBoundary>
    </div>
  );
}

function useModelListClock(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const update = () => {
      setNow(Date.now());
    };
    update();
    const timer = setInterval(update, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return now;
}

function catalogAge(locale: InterfaceLocale, service: string, updatedAt: string, now: number) {
  return message(locale, "agents.catalogAge", {
    date: formatDate(locale, new Date(openaiCatalogCheckedOn), {
      dateStyle: "medium",
      timeZone: "UTC",
    }),
    service,
    age: relativeAge(locale, updatedAt, now),
  });
}

export function AgentsSettings({
  port,
  settings,
  locale,
  connections,
  snapshots,
  recoveryFocusId,
}: {
  readonly port: FoundationPort;
  readonly settings: Settings;
  readonly locale: InterfaceLocale;
  readonly connections: readonly Service[];
  readonly snapshots: Readonly<Record<string, ConnectionSnapshot | undefined>>;
  /** The element that receives focus when a recovery action leaves its notice. */
  readonly recoveryFocusId: string;
}) {
  return (
    <div className="agent-settings">
      <p className="settings-info">
        <Icon name="info" />
        {message(locale, "agents.applies")}
      </p>
      <RecoveryFocusBoundary
        className="agent-focus-recovery"
        onRecover={() => {
          document.getElementById(recoveryFocusId)?.focus();
        }}
      >
        {settings.failed && (
          <CatalogReadFailure
            locale={locale}
            retry={() => {
              void settings.read();
            }}
          />
        )}
      </RecoveryFocusBoundary>
      {agentPreferenceTargets.map((target) => (
        <PreferenceControls
          key={target}
          {...{ target, settings, port, locale, connections, snapshots }}
        />
      ))}
    </div>
  );
}

/** The age and refresh action of one connected service's model list. */
export function ModelListRefresh({
  port,
  settings,
  locale,
  service,
  snapshot,
  probeResult,
}: {
  readonly port: FoundationPort;
  readonly settings: Settings;
  readonly locale: InterfaceLocale;
  readonly service: Service;
  readonly snapshot: ConnectionSnapshot | undefined;
  readonly probeResult?: Extract<ConnectionEvent, { kind: "probe_result" }> | undefined;
}) {
  const [state, setState] = useState<"updating" | "failed">();
  const connected = snapshot?.state === "connected";
  const now = useModelListClock(connected);
  const lastProbeResult = useRef(probeResult);
  useEffect(() => {
    const prior = lastProbeResult.current;
    lastProbeResult.current = probeResult;
    if (!probeResult || prior === probeResult) return;
    setState((previous) =>
      previous !== "updating"
        ? previous
        : probeResult.outcome === "unreachable"
          ? "failed"
          : undefined,
    );
  }, [probeResult]);
  if (!connected) return null;
  const list = settings.data?.lists.find(
    ({ connection, current }) => connection === service.id && current !== false,
  );
  const params = { service: service.displayName };
  return (
    <div className="agent-choice model-list-refresh">
      {list &&
        (service.id === openaiApiKeyConnection.id ? (
          <>
            <p>{message(locale, "agents.catalogUnlisted")}</p>
            <p>{catalogAge(locale, service.displayName, list.updatedAt, now)}</p>
          </>
        ) : (
          <p>
            {message(locale, "agents.listAge", {
              ...params,
              age: relativeAge(locale, list.updatedAt, now),
            })}
          </p>
        ))}
      {state === "updating" && <p role="status">{message(locale, "agents.refreshing", params)}</p>}
      {state === "failed" && (
        <p
          className="connection-notice connection-attention"
          role="status"
          data-settings-attention="triangle-alert"
        >
          <Icon name="triangle-alert" />
          {message(locale, "agents.refreshFailed")}
        </p>
      )}
      <button
        type="button"
        className="primitive-button"
        aria-disabled={snapshot.probing || state === "updating" || undefined}
        onClick={() => {
          if (snapshot.probing || state === "updating") return;
          setState("updating");
          void port.probeConnection(service.id).result.then((outcome) => {
            if (!outcome.ok) setState("failed");
          });
        }}
      >
        <Icon name="list-restart" />
        {message(locale, "agents.refresh", params)}
      </button>
    </div>
  );
}
