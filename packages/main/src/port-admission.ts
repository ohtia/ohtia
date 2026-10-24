import {
  decodeText,
  failure,
  portLimits,
  type Outcome,
  type Request,
  type Envelope,
} from "@ohtia/contracts";

/** Obtained from the live Electron senderFrame by runtime composition, never from JSON. */
export interface FrameSender {
  readonly frame: object;
  readonly url: string;
}
export interface WindowAuthority extends FrameSender {
  readonly windowGeneration: string;
  readonly serviceGeneration: string;
}

/** Shared by every window attached to the single broker. Cancellation does not release a service slot. */
export class PortAdmission {
  private readonly windows = new Map<
    object,
    { authority: WindowAuthority; pending: Map<string, Request>; subscriptions: Set<string> }
  >();
  private count = 0;
  private subscriptionCount = 0;
  attach(authority: WindowAuthority): Outcome<() => void> {
    if (this.windows.has(authority.frame)) return failure("unauthorized");
    if (this.windows.size >= portLimits.windows) return failure("window_limit");
    const state = {
      authority: { ...authority },
      pending: new Map<string, Request>(),
      subscriptions: new Set<string>(),
    };
    const frame = authority.frame;
    this.windows.set(frame, state);
    return {
      ok: true,
      value: () => {
        // Detaching revokes the frame immediately; accepted work retains its slots until terminal receipt.
        if (this.windows.get(frame) === state) this.windows.delete(frame);
      },
    };
  }
  authorize(sender: FrameSender, text: unknown): Outcome<Envelope> {
    const state = this.windows.get(sender.frame);
    if (!state || state.authority.url !== sender.url) return failure("unauthorized");
    const decoded = decodeText(text);
    if (!decoded.ok) return decoded;
    if (decoded.value.kind === "result" || decoded.value.kind === "event")
      return failure("unauthorized");
    if (
      decoded.value.windowGeneration !== state.authority.windowGeneration ||
      decoded.value.serviceGeneration !== state.authority.serviceGeneration
    )
      return failure("stale_generation");
    return decoded;
  }
  admit(
    sender: FrameSender,
    text: unknown,
  ): Outcome<{ readonly request: Request; release(): void; releaseSubscription(): void }> {
    const authorized = this.authorize(sender, text);
    if (!authorized.ok) return authorized;
    const request = authorized.value;
    if (request.kind !== "request") return failure("invalid_message");
    const state = this.windows.get(sender.frame);
    if (!state) return failure("unauthorized");
    if (state.pending.has(request.requestId)) return failure("duplicate_request");
    if (
      state.pending.size >= portLimits.pending_per_window ||
      this.count >= portLimits.pending_global
    )
      return failure("busy");
    const subscriptionId =
      request.operation === "status.subscribe" || request.operation === "appearance.subscribe"
        ? request.payload.subscriptionId
        : undefined;
    if (subscriptionId !== undefined) {
      if (state.subscriptions.has(subscriptionId)) return failure("duplicate_request");
      if (
        state.subscriptions.size >= portLimits.subscriptions_per_window ||
        this.subscriptionCount >= portLimits.windows * portLimits.subscriptions_per_window
      )
        return failure("busy");
      state.subscriptions.add(subscriptionId);
      this.subscriptionCount++;
    }
    state.pending.set(request.requestId, request);
    this.count++;
    let released = false;
    let subscriptionReleased = false;
    return {
      ok: true,
      value: {
        request,
        releaseSubscription: () => {
          if (subscriptionId === undefined || subscriptionReleased) return;
          subscriptionReleased = true;
          state.subscriptions.delete(subscriptionId);
          this.subscriptionCount--;
        },
        release: () => {
          if (released) return;
          released = true;
          state.pending.delete(request.requestId);
          this.count--;
        },
      },
    };
  }
}
