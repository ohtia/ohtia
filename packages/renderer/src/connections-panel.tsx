import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  message,
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
/** A subscription row consumes only main's public state and complete revision-bound model pages. */
export function ConnectionsPanel({
  port,
  locale,
  available,
}: {
  readonly port: FoundationPort;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
}) {
  const id = useId();
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>();
  const [probe, setProbe] = useState<ProbeResult>();
  const [failed, setFailed] = useState(false);
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
    if (latest.current?.state !== value.state && focused && actions.current?.contains(focused))
      restore.current = true;
    latest.current = value;
    setSnapshot(value);
    setFailed(false);
  }, []);
  useEffect(() => {
    const target = actions.current?.querySelector<HTMLButtonElement>("button");
    if (restore.current && target) {
      target.focus();
      restore.current = false;
    }
  }, [snapshot, failed]);
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
    if (!available)
      return () => {
        stopped = true;
      };
    const stream = port.subscribeConnection("chatgpt", (notice) => {
      if (!active()) return;
      eventVersion++;
      if (!notice.ok) {
        generation.current++;
        probeVersion++;
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
    });
    void stream.ready.then(async (result) => {
      if (!active()) return;
      if (!result.ok) {
        generation.current++;
        setFailed(true);
        setPending(false);
        return;
      }
      const version = eventVersion;
      const resultRead = await run(port.readConnection("chatgpt"));
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
  }, [port, available, accept, recovery]);
  const act = async (kind: "connect" | "another" | "disconnect" | "probe") => {
    if (!available || pending) return;
    const lifetime = generation.current;
    const before = latest.current;
    setPending(true);
    setProbe(undefined);
    const call =
      kind === "disconnect"
        ? port.disconnectConnection("chatgpt")
        : kind === "probe"
          ? port.probeConnection("chatgpt")
          : port.connectConnection(
              "chatgpt",
              kind === "another" ? { new_registration: true } : undefined,
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
        <h3 id={`${id}-title`}>{title}</h3>
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
  let stateText: string | ReturnType<typeof emailText>;
  if (connecting) stateText = message(locale, "connection.waiting", { service });
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
      <h3 id={`${id}-title`}>{title}</h3>
      <div className="connection-row" aria-labelledby={`${id}-service`}>
        <h4 id={`${id}-service`}>{service}</h4>
        <div
          className={attention ? "connection-notice connection-attention" : "connection-state"}
          role="status"
        >
          {attention && <Icon name="triangle-alert" />}
          <p>{stateText}</p>
        </div>
        {remembered &&
          (snapshot.state !== "disconnected" || snapshot.reason === "sign_in_timeout") && (
            <p>{emailText("connection.lastAccount")}</p>
          )}
        <div>
          <RecoveryFocusBoundary
            onRecover={() => actions.current?.querySelector<HTMLButtonElement>("button")?.focus()}
          >
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
          </RecoveryFocusBoundary>
          <div className="connection-feedback" role="status" aria-atomic="true">
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
                      <p>{message(locale, "connection.works", { service })}</p>
                      <p>
                        {message(locale, "connection.models", {
                          models: new Intl.ListFormat(locale, {
                            style: "long",
                            type: "conjunction",
                          }).format(probe.models),
                        })}
                      </p>
                      <p>{message(locale, "connection.unknownPlan", { service })}</p>
                    </>
                  ) : (
                    <p>{message(locale, "connection.unreachable", { service })}</p>
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
