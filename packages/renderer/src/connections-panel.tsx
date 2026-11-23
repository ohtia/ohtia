import {
  useCallback,
  useMemo,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  message,
  formatDate,
  isProviderApiKey,
  keyCheckReasons,
  type FoundationPort,
  type InterfaceLocale,
  type ConnectionSnapshot,
  type ConnectionEvent,
  type PortCall,
  type ModelPage,
} from "@ohtia/contracts";
import { LucideGlyph as Icon } from "./iconography.js";
import { RecoveryFocusBoundary } from "./settings-notices.js";

type ProbeResult =
  | { readonly kind: "listed"; readonly models: readonly string[] }
  | { readonly kind: "unreachable" };
/** Each connection row consumes only main's public state and complete revision-bound model pages. */
export function ConnectionsPanel({
  port,
  locale,
  available,
  onConnection,
  connection = "chatgpt",
  kind = "subscription",
  renderAfterState,
  onCatalogRead,
  onProbeResult,
  subscribeConnection,
  embedded = false,
}: {
  readonly connection?: string;
  readonly kind?: "subscription" | "api_key";
  readonly renderAfterState?: (snapshot: ConnectionSnapshot, justConnected: boolean) => ReactNode;
  readonly embedded?: boolean;
  readonly onCatalogRead?: () => void;
  readonly onProbeResult?: (event: Extract<ConnectionEvent, { kind: "probe_result" }>) => void;
  readonly subscribeConnection?: FoundationPort["subscribeConnection"];
  readonly onConnection?: (snapshot: ConnectionSnapshot | undefined) => void;
  readonly port: FoundationPort;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
}) {
  const onProbe = useRef(onProbeResult);
  onProbe.current = onProbeResult;
  const subscribe = useMemo(
    () => subscribeConnection ?? port.subscribeConnection.bind(port),
    [port, subscribeConnection],
  );
  const onCatalog = useRef(onCatalogRead);
  onCatalog.current = onCatalogRead;
  const connectionObserver = useRef(onConnection);
  connectionObserver.current = onConnection;
  const id = useId();
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>();
  const [probe, setProbe] = useState<ProbeResult>();
  const [failed, setFailed] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState(0);
  const actions = useRef<HTMLDivElement>(null);
  const restore = useRef(false);
  const retryFocus = useRef<HTMLButtonElement | null>(null);
  const generation = useRef(0);
  const latest = useRef<ConnectionSnapshot>(undefined);
  const calls = useRef(new Set<PortCall<unknown>>());
  const accept = useCallback((value: ConnectionSnapshot) => {
    const focused = document.activeElement;
    if (retryFocus.current && focused !== retryFocus.current) restore.current = false;
    retryFocus.current = null;
    if (
      latest.current?.state !== value.state &&
      !value.checking_key &&
      focused &&
      focused !== actions.current &&
      actions.current?.contains(focused)
    )
      restore.current = true;
    connectionObserver.current?.(value);
    if (value.state === "connected" && latest.current && latest.current.state !== "connected")
      setJustConnected(true);
    if (value.state !== "connected") setJustConnected(false);
    latest.current = value;
    setSnapshot(value);
    setFailed(false);
  }, []);
  useEffect(() => {
    const target = actions.current?.querySelector<HTMLButtonElement>("button");
    if (restore.current && target) {
      if (kind !== "api_key" || document.activeElement === document.body) target.focus();
      restore.current = false;
    }
  }, [snapshot, failed, kind]);
  useEffect(() => {
    const lifetime = ++generation.current;
    let eventVersion = 0;
    let probeVersion = 0;
    let stopped = false;
    const active = () => !stopped && lifetime === generation.current;
    const run = async <T,>(call: PortCall<T>) => {
      calls.current.add(call);
      try {
        return await call.result;
      } finally {
        calls.current.delete(call);
      }
    };
    const models = async (event: ConnectionEvent) => {
      const work = ++probeVersion;
      let revision = event.model_list_revision;
      let cursor = 0;
      const names: string[] = [];
      while (active() && work === probeVersion && revision !== null) {
        const page = await run<ModelPage>(
          port.listConnectionModels({
            connection: event.connection,
            model_list_revision: revision,
            cursor,
            count: 128,
          }),
        );
        if (!active() || work !== probeVersion) return;
        if (!page.ok) {
          if (
            page.error.code === "stale_revision" &&
            page.error.parameters.currentRevision &&
            page.error.parameters.currentRevision !== revision
          ) {
            revision = page.error.parameters.currentRevision;
            cursor = 0;
            names.length = 0;
            continue;
          }
          setProbe({ kind: "unreachable" });
          return;
        }
        names.push(...page.value.models.map((model) => model.name));
        if (!page.value.hasMore) {
          setProbe({ kind: "listed", models: names });
          return;
        }
        if (page.value.nextCursor <= cursor) {
          setProbe({ kind: "unreachable" });
          return;
        }
        cursor = page.value.nextCursor;
      }
    };
    setPending(false);
    if (!available) {
      connectionObserver.current?.(undefined);
      return () => {
        stopped = true;
      };
    }
    const stream = subscribe(connection, (notice) => {
      if (!active()) return;
      eventVersion++;
      if (!notice.ok) {
        generation.current++;
        probeVersion++;
        connectionObserver.current?.(undefined);
        setFailed(true);
        setPending(false);
        return;
      }
      const event = notice.value;
      accept(event);
      if (event.probing) {
        probeVersion++;
        setProbe(undefined);
      }
      if (event.state !== "connected") {
        probeVersion++;
        setProbe(undefined);
      }
      if (event.kind === "probe_result" && event.state === "connected") {
        if (event.outcome === "listed") void models(event);
        else setProbe({ kind: "unreachable" });
      }
      if (event.kind === "probe_result") {
        onProbe.current?.(event);
        if (event.outcome === "listed") onCatalog.current?.();
      }
    });
    void stream.ready.then(async (result) => {
      if (!active()) return;
      if (!result.ok) {
        generation.current++;
        connectionObserver.current?.(undefined);
        setFailed(true);
        setPending(false);
        return;
      }
      const version = eventVersion;
      const resultRead = await run(port.readConnection(connection));
      if (!active() || version !== eventVersion) return;
      if (resultRead.ok) accept(resultRead.value);
      else setFailed(true);
    });
    return () => {
      stopped = true;
      probeVersion++;
      if (generation.current === lifetime) generation.current++;
      stream.dispose();
      for (const call of calls.current) call.cancel();
      calls.current.clear();
    };
  }, [port, connection, available, accept, recovery, subscribe]);
  const act = async (
    kind: "connect" | "another" | "disconnect" | "probe" | "saveKey" | "replaceKey",
    key?: string,
  ) => {
    if (!available || pending) return;
    const lifetime = generation.current;
    const before = latest.current;
    setPending(true);
    setProbe(undefined);
    const call =
      kind === "disconnect"
        ? port.disconnectConnection(connection)
        : kind === "probe"
          ? port.probeConnection(connection)
          : kind === "replaceKey" && key
            ? port.replaceConnectionKey(connection, key)
            : port.connectConnection(
                connection,
                kind === "another" ? { new_registration: true } : key ? { key } : undefined,
              );
    calls.current.add(call);
    try {
      const result = await call.result;
      if (lifetime !== generation.current) return;
      if (result.ok) {
        if (latest.current === before) accept(result.value);
      } else setFailed(true);
    } finally {
      calls.current.delete(call);
      if (lifetime === generation.current) setPending(false);
    }
  };
  const retry = (target: HTMLButtonElement) => {
    if (!available) return;
    restore.current = document.activeElement === target;
    retryFocus.current = restore.current ? target : null;
    setRecovery((value) => value + 1);
  };
  const title = message(locale, "connection.title");
  if (!snapshot)
    return (
      <section aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`} hidden={embedded}>
          {title}
        </h3>
        <p role="status">{!available || failed ? message(locale, "settings.unavailable") : ""}</p>
        {available && failed && (
          <div ref={actions} className="connection-actions">
            <button
              type="button"
              onClick={(event) => {
                retry(event.currentTarget);
              }}
            >
              {message(locale, "retry")}
            </button>
          </div>
        )}
      </section>
    );
  const service = snapshot.display_name;
  const email = snapshot.last_account_email;
  const connected = snapshot.state === "connected";
  const connecting = snapshot.state === "connecting";
  const attention = snapshot.state === "error" || snapshot.state === "expired";
  const remembered =
    email !== null && !connecting && !connected && snapshot.reason !== "store_unavailable";
  const browserIcon = (
    <span role="img" aria-label={message(locale, "connection.browserIcon")}>
      <Icon name="external-link" />
    </span>
  );
  const emailText = (
    key:
      | "connection.connected"
      | "connection.notConnectedAccount"
      | "connection.lastAccount"
      | "connection.signInAs",
  ) => {
    const parts = message(locale, key, { email: "\ufffc" }).split("\ufffc");
    return (
      <>
        {parts[0]}
        <bdi className="connection-email">
          {key === "connection.connected" ? (snapshot.account_email ?? email) : email}
        </bdi>
        {parts[1]}
      </>
    );
  };
  const apiKey = kind === "api_key";
  let stateText: string | ReturnType<typeof emailText>;
  if (apiKey) {
    if (snapshot.reason === "store_unavailable")
      stateText = message(locale, "connection.apiKey.storeUnavailable", { service });
    else if (snapshot.state === "expired")
      stateText = message(
        locale,
        snapshot.reason === "key_needs_workspace"
          ? "connection.apiKey.workspace"
          : "connection.apiKey.expired",
        { service },
      );
    else if (connected)
      stateText = snapshot.connected_at
        ? message(locale, "connection.apiKey.connected", {
            service,
            date: formatDate(locale, new Date(snapshot.connected_at), { dateStyle: "medium" }),
          })
        : message(locale, "connection.apiKey.connectedWithoutDate", { service });
    else stateText = message(locale, "connection.notConnected");
  } else if (connecting) stateText = message(locale, "connection.waiting", { service });
  else if (connected) stateText = emailText("connection.connected");
  else if (snapshot.state === "expired")
    stateText = message(locale, "connection.expired", { service });
  else if (snapshot.reason === "store_unavailable")
    stateText = message(locale, "connection.storeUnavailable");
  else if (snapshot.reason === "plan_use_not_allowed")
    stateText = message(locale, "connection.planNotAllowed", { service });
  else if (snapshot.reason === "sign_in_rejected")
    stateText = message(locale, "connection.rejected", { service });
  else if (snapshot.reason === "sign_in_timeout") stateText = message(locale, "connection.timeout");
  else
    stateText = email
      ? emailText("connection.notConnectedAccount")
      : message(locale, "connection.notConnected");
  const disabled = !available || pending || failed;
  return (
    <section className="settings-connections" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} hidden={embedded}>
        {title}
      </h3>
      <div className="connection-row" aria-labelledby={`${id}-service`}>
        <h4 id={`${id}-service`}>{service}</h4>
        {!!stateText && (
          <div
            className={attention ? "connection-notice connection-attention" : "connection-state"}
            role="status"
          >
            {attention && <Icon name="triangle-alert" />}
            <p>{stateText}</p>
          </div>
        )}
        {renderAfterState?.(snapshot, justConnected)}
        {remembered &&
          (snapshot.state !== "disconnected" || snapshot.reason === "sign_in_timeout") && (
            <p>{emailText("connection.lastAccount")}</p>
          )}
        <div>
          <RecoveryFocusBoundary
            onRecover={() => actions.current?.querySelector<HTMLButtonElement>("button")?.focus()}
          >
            {apiKey ? (
              <ApiKeyControls
                {...{ snapshot, disabled, actions, locale, act }}
                enterKey={(key, replace) => act(replace ? "replaceKey" : "saveKey", key)}
              />
            ) : (
              <div ref={actions} className="connection-actions">
                {connecting ? (
                  <button
                    type="button"
                    aria-disabled={disabled}
                    onClick={() => {
                      if (!disabled) void act("disconnect");
                    }}
                  >
                    {message(locale, "connection.cancel")}
                  </button>
                ) : connected ? (
                  <>
                    <button
                      type="button"
                      aria-disabled={disabled || snapshot.probing}
                      onClick={() => {
                        if (!disabled && !snapshot.probing) void act("probe");
                      }}
                    >
                      {message(locale, "connection.test")}
                    </button>
                    <button
                      type="button"
                      aria-disabled={disabled}
                      onClick={() => {
                        if (!disabled) void act("disconnect");
                      }}
                    >
                      {message(locale, "connection.signOut", { service })}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      data-primary="true"
                      className="primitive-primary"
                      aria-disabled={disabled}
                      onClick={() => {
                        if (!disabled) void act("connect");
                      }}
                    >
                      {snapshot.reason === "plan_use_not_allowed"
                        ? message(locale, "connection.allowPlan")
                        : remembered
                          ? emailText("connection.signInAs")
                          : message(locale, "connection.signIn", { service })}
                      {browserIcon}
                    </button>
                    {remembered && (
                      <button
                        type="button"
                        aria-disabled={disabled}
                        onClick={() => {
                          if (!disabled) void act("another");
                        }}
                      >
                        {message(locale, "connection.anotherAccount")}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </RecoveryFocusBoundary>
          <div className="connection-feedback" role="status" aria-atomic="true">
            {apiKey && snapshot.checking_key && (
              <p>{message(locale, "connection.apiKey.checking", { service })}</p>
            )}
            {!failed && snapshot.probing && (
              <p>{message(locale, "connection.testing", { service })}</p>
            )}
            {connected && probe && (
              <div
                className={`connection-notice ${probe.kind === "listed" ? "connection-info" : "connection-danger"}`}
              >
                <Icon name={probe.kind === "listed" ? "info" : "octagon-alert"} />
                <div>
                  {probe.kind === "listed" ? (
                    <>
                      <p>
                        {message(locale, apiKey ? "connection.apiKey.works" : "connection.works", {
                          service,
                        })}
                      </p>
                      <p>
                        {message(locale, "connection.models", {
                          models: new Intl.ListFormat(locale, {
                            style: "long",
                            type: "conjunction",
                          }).format(probe.models),
                        })}
                      </p>
                      {!apiKey && <p>{message(locale, "connection.unknownPlan", { service })}</p>}
                    </>
                  ) : (
                    <p>
                      {message(
                        locale,
                        apiKey ? "connection.apiKey.unreachable" : "connection.unreachable",
                        { service },
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}
            {failed && <p>{message(locale, "settings.unavailable")}</p>}
          </div>
          {available && failed && (
            <div className="connection-actions connection-retry">
              <button
                type="button"
                onClick={(event) => {
                  retry(event.currentTarget);
                }}
              >
                {message(locale, "retry")}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const keyErrors = {
  key_rejected: "connection.apiKey.rejected",
  key_not_permitted: "connection.apiKey.notPermitted",
  key_needs_workspace: "connection.apiKey.workspace",
  key_check_unreachable: "connection.apiKey.checkUnreachable",
  key_check_unavailable: "connection.apiKey.checkUnavailable",
} as const;

function ApiKeyControls({
  snapshot,
  disabled,
  actions,
  locale,
  act,
  enterKey,
}: {
  readonly snapshot: ConnectionSnapshot;
  readonly disabled: boolean;
  readonly actions: RefObject<HTMLDivElement | null>;
  readonly locale: InterfaceLocale;
  readonly act: (kind: "disconnect" | "probe") => Promise<void>;
  readonly enterKey: (key: string, replace: boolean) => Promise<void>;
}) {
  const id = useId();
  const [mode, setMode] = useState<"key" | "disconnect">();
  const keyField = useRef<HTMLInputElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const restore = useRef<"key" | "disconnect" | undefined>(undefined);
  const service = snapshot.display_name;
  const connected = snapshot.state === "connected";
  const replace = connected || snapshot.state === "expired";
  const checking = snapshot.checking_key === true;
  const dismiss = () => {
    if (keyField.current) keyField.current.value = "";
    restore.current = mode;
    setMode(undefined);
  };
  useEffect(() => {
    if (mode === "key") keyField.current?.focus();
    else if (mode === "disconnect") keep.current?.focus();
  }, [mode]);
  useEffect(() => {
    if (!mode && restore.current && !checking && !disabled) {
      const target = restore.current === "key" ? "[data-key-entry]" : "[data-disconnect]";
      if (document.activeElement === actions.current || document.activeElement === document.body)
        (
          actions.current?.querySelector<HTMLButtonElement>(target) ??
          actions.current?.querySelector<HTMLButtonElement>("button")
        )?.focus();
      restore.current = undefined;
    }
  }, [mode, checking, disabled, actions, snapshot.state]);
  const error = keyCheckReasons.find((reason) => reason === snapshot.reason);
  return (
    <>
      <div
        ref={actions}
        tabIndex={-1}
        className="connection-actions"
        onKeyDown={(event) => {
          if (mode && event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          }
        }}
      >
        {!checking &&
          (mode === "key" ? (
            <form
              className="connection-key-form primitive-field"
              onSubmit={(event) => {
                event.preventDefault();
                const key = keyField.current?.value.trim() ?? "";
                if (disabled || !isProviderApiKey(key)) return;
                actions.current?.focus();
                dismiss();
                void enterKey(key, replace);
              }}
            >
              <p id={id + "-charge"}>
                {message(locale, "connection.apiKey.charging", { service })}
              </p>
              <label htmlFor={id + "-key"}>
                {message(locale, "connection.apiKey.label", { service })}
              </label>
              <input
                ref={keyField}
                id={id + "-key"}
                aria-describedby={id + "-charge"}
                type="password"
                autoComplete="off"
                spellCheck={false}
                minLength={1}
                maxLength={1024}
                required
                pattern="[!-~]+"
              />
              <div className="connection-actions">
                <button
                  className="primitive-primary"
                  data-primary="true"
                  type="submit"
                  disabled={disabled}
                >
                  {message(locale, "connection.apiKey.save")}
                </button>
                <button type="button" onClick={dismiss}>
                  {message(locale, "connection.apiKey.close")}
                </button>
              </div>
            </form>
          ) : mode === "disconnect" && connected ? (
            <div
              role="group"
              aria-labelledby={id + "-disconnect"}
              aria-describedby={id + "-consequence"}
            >
              <p id={id + "-disconnect"}>
                {message(locale, "connection.apiKey.disconnectTitle", { service })}
              </p>
              <p id={id + "-consequence"}>
                {message(locale, "connection.apiKey.disconnectBody", { service })}
              </p>
              <div className="connection-actions">
                <button type="button" ref={keep} onClick={dismiss}>
                  {message(locale, "connection.apiKey.keep")}
                </button>
                <button
                  type="button"
                  className="primitive-destructive"
                  aria-disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    dismiss();
                    void act("disconnect");
                  }}
                >
                  {message(locale, "connection.apiKey.disconnect", { service })}
                </button>
              </div>
            </div>
          ) : (
            <>
              {connected && (
                <button
                  type="button"
                  aria-disabled={disabled || snapshot.probing}
                  onClick={() => {
                    if (!disabled && !snapshot.probing) void act("probe");
                  }}
                >
                  {message(locale, "connection.test")}
                </button>
              )}
              <button
                type="button"
                data-key-entry
                aria-disabled={disabled}
                onClick={() => {
                  if (!disabled) setMode("key");
                }}
              >
                {replace
                  ? message(locale, "connection.apiKey.replace")
                  : message(locale, "connection.apiKey.add", { service })}
              </button>
              {connected && (
                <button
                  type="button"
                  data-disconnect
                  aria-disabled={disabled}
                  onClick={() => {
                    if (!disabled) setMode("disconnect");
                  }}
                >
                  {message(locale, "connection.apiKey.disconnect", { service })}
                </button>
              )}
            </>
          ))}
      </div>
      {error && !(snapshot.state === "expired" && error === "key_needs_workspace") && (
        <div className="connection-notice connection-danger" role="alert">
          <Icon name="octagon-alert" />
          <p>{message(locale, keyErrors[error], { service })}</p>
        </div>
      )}
    </>
  );
}
