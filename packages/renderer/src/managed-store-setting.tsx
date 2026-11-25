import { useEffect, useMemo, useState } from "react";
import {
  message,
  type BootstrapState,
  type FoundationPort,
  type InterfaceLocale,
  type ManagedStoreLocation,
  type Outcome,
} from "@ohtia/contracts";

export function ManagedStoreSetting({
  port,
  locale,
  storageState,
  serviceGeneration,
}: {
  readonly port: Pick<FoundationPort, "readManagedStoreLocation">;
  readonly locale: InterfaceLocale;
  readonly storageState: BootstrapState;
  readonly serviceGeneration: string | undefined;
}) {
  const [checks, setChecks] = useState(0);
  const attempt = useMemo(
    () => ({ storageState, serviceGeneration, checks }),
    [storageState, serviceGeneration, checks],
  );
  const [snapshot, setSnapshot] = useState<{
    attempt: typeof attempt;
    port: typeof port;
    result: Outcome<ManagedStoreLocation>;
  }>();
  useEffect(() => {
    let active = true;
    const call = port.readManagedStoreLocation();
    void call.result.then((result) => {
      if (active) setSnapshot({ attempt, port, result });
    });
    return () => {
      active = false;
      call.cancel();
    };
  }, [port, attempt]);
  const result =
    snapshot && snapshot.port === port && snapshot.attempt === attempt
      ? snapshot.result
      : undefined;
  let status;
  if (!result) status = message(locale, "settings.storage.checking");
  else if (!result.ok)
    status = message(
      locale,
      result.error.code === "busy" ? "command.reason.busy" : "settings.storage.unavailable",
    );
  else if (result.value.state === "available")
    status = (
      <bdi dir="ltr" className="managed-store-directory">
        {result.value.directory}
      </bdi>
    );
  else {
    const reason = result.value.reason;
    const key =
      reason === "pending_create" || reason === "located"
        ? "settings.storage.openData"
        : reason === "missing"
          ? "settings.storage.locatorMissing"
          : reason === "location_display_unavailable"
            ? "settings.storage.unavailable"
            : reason;
    status = message(locale, key);
  }
  return (
    <>
      <p>{message(locale, "settings.storage.sensitivity")}</p>
      <p role="status">{status}</p>
      <div>
        <button
          type="button"
          className="primitive-button"
          aria-disabled={!result}
          onClick={() => {
            if (result) setChecks((value) => value + 1);
          }}
        >
          {message(locale, "settings.storage.check")}
        </button>
      </div>
    </>
  );
}
