import {
  type Outcome,
  type PlanEvent,
  type PlanSnapshot,
  type ResearchEvent,
  type ResearchPort,
} from "@ohtia/contracts";

type PlanPort = Pick<ResearchPort, "readPlan" | "listPlanEvents">;
type PlanNotice = Extract<ResearchEvent, { kind: "planChanged" }>;

/** A window can feed its existing research subscription here and refresh after reconnecting. */
export class PlanClient {
  private pending: Promise<unknown> = Promise.resolve();
  private snapshot: PlanSnapshot | undefined;
  private through = 0;
  private readonly hashes = new Map<number, string>();

  constructor(
    private readonly port: PlanPort,
    private readonly planId: string,
    private readonly onSnapshot: (snapshot: PlanSnapshot) => void,
    private readonly onEvent: (event: PlanEvent) => void,
  ) {}

  refresh(): Promise<Outcome<PlanSnapshot>> {
    return this.enqueue(() => this.reread());
  }

  receive(notice: PlanNotice): Promise<Outcome<PlanSnapshot> | undefined> {
    return this.enqueue(async () => {
      if (notice.planId !== this.planId) return;
      if (
        notice.throughSequence <= this.through &&
        notice.revision <= (this.snapshot?.revision ?? 0)
      )
        return;
      let target = notice.throughSequence;
      while (this.through < target) {
        const response = await this.port.listPlanEvents({
          planId: this.planId,
          afterSequence: this.through,
        }).result;
        if (!response.ok) return response;
        if (!response.value.events.length) return this.reread();
        target = Math.max(target, response.value.throughSequence);
        for (const event of response.value.events)
          if (!this.acceptEvent(event)) return this.reread();
      }
      return this.reread();
    });
  }

  /** Handle an event replay from a restored or overlapping client cursor. */
  receiveEvent(event: PlanEvent): Promise<Outcome<PlanSnapshot> | undefined> {
    return this.enqueue(async () => {
      if (!this.acceptEvent(event)) return this.reread();
    });
  }

  private acceptEvent(event: PlanEvent): boolean {
    if (event.sequence <= this.through)
      return this.hashes.get(event.sequence) === event.payloadHash;
    if (event.sequence !== this.through + 1) return false;
    this.through = event.sequence;
    this.hashes.set(event.sequence, event.payloadHash);
    if (this.snapshot?.outcome !== "cancelled") this.onEvent(event);
    return true;
  }

  private async reread(): Promise<Outcome<PlanSnapshot>> {
    const result = await this.port.readPlan({ planId: this.planId }).result;
    if (!result.ok) return result;
    const next = result.value;
    if (
      this.snapshot &&
      (next.revision < this.snapshot.revision ||
        (this.snapshot.outcome === "cancelled" && next.outcome !== "cancelled"))
    )
      return { ok: true, value: this.snapshot };
    this.through = next.throughSequence;
    for (const sequence of this.hashes.keys())
      if (sequence > this.through) this.hashes.delete(sequence);
    this.snapshot = next;
    this.onSnapshot(next);
    return result;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => undefined);
    return result;
  }
}
