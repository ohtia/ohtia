import {
  failure,
  type ConnectionEvent,
  type FoundationPort,
  type Outcome,
  type Subscription,
} from "@ohtia/contracts";

type Listener = (notice: Outcome<ConnectionEvent>) => void;
type ConnectionPort = Partial<Pick<FoundationPort, "subscribeConnection">>;
const windows = new WeakMap<ConnectionPort, FoundationPort["subscribeConnection"]>();

/** All connection consumers in a window share one of its bounded port subscriptions. */
export function windowConnectionSubscription(
  port: ConnectionPort,
): FoundationPort["subscribeConnection"] {
  const existing = windows.get(port);
  if (existing) return existing;
  const open = port.subscribeConnection?.bind(port);
  if (!open)
    return () => ({ ready: Promise.resolve(failure("service_unavailable")), dispose() {} });
  const listeners = new Set<{ connection: string; receive: Listener }>();
  let stream: Subscription | undefined;
  let generation = 0;
  const close = (active: Subscription) => {
    if (stream !== active) return;
    stream = undefined;
    active.dispose();
  };
  const subscribe: FoundationPort["subscribeConnection"] = (connection, receive) => {
    const member = { connection, receive };
    listeners.add(member);
    if (!stream) {
      const opened = ++generation;
      const active = open("*", (notice) => {
        if (!stream || generation !== opened) return;
        if (!notice.ok) close(stream);
        for (const member of [...listeners]) {
          if (!notice.ok || member.connection === notice.value.connection) member.receive(notice);
        }
      });
      stream = active;
      void active.ready.then((result) => {
        if (!result.ok) close(active);
      });
    }
    return {
      ready: stream.ready,
      dispose() {
        listeners.delete(member);
        if (stream && !listeners.size) close(stream);
      },
    };
  };
  windows.set(port, subscribe);
  return subscribe;
}
