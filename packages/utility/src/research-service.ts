import { createHash } from "node:crypto";
import {
  failure,
  isResearchMutation,
  isResearchOperation,
  policyId,
  projectResearchScope,
  type Request,
  type ResearchCommand,
  type ResearchEvent,
  type ResearchScope,
  type Outcome,
} from "@ohtia/contracts";
import { canonicalJson } from "./research.js";
import { TextStaging } from "./research-text.js";
import { profileSaveHash } from "./thesis-profile.js";
import { stageTransitionHash, stageTransitionPayload } from "./research-stage.js";
import { manuscriptIntentHash, manuscriptSaveIntent } from "./manuscript-revisions.js";
import { fitsResearchResult } from "./research-reads.js";
import type { DurableStore } from "./storage.js";
import type { DurableProvider } from "./durable-provider.js";
function revisionKey(event: Extract<ResearchEvent, { kind: "changed" | "planChanged" }>): string {
  return event.kind === "planChanged" ? `plan/${event.planId}` : `${event.record}/${event.id}`;
}
interface Stream {
  readonly window: string;
  readonly id: string;
  readonly scope: ResearchScope;
  revisions: Map<string, number>;
  sequence: number;
  running: number;
  pauseRevision: number;
}
/** Serialized by the existing status-service queue; no second execution or storage authority. */
export class ResearchService {
  private readonly staging = new TextStaging();
  private readonly streams = new Map<string, Stream>();
  private readonly stopPauseObservation: () => void;
  private readonly stopActivityObservation: () => void;
  constructor(
    private readonly storage: DurableStore,
    private readonly generation: string,
    private readonly emit: (value: unknown) => void,
    private readonly provider: DurableProvider,
    private readonly providerFailure: () => void,
  ) {
    this.stopActivityObservation = storage.observeResearchActivity((event) => {
      for (const stream of this.streams.values()) {
        if (event.kind === "replyFinished" && stream.scope.projectId !== event.projectId) continue;
        if (event.kind === "attentionRaised") {
          const { kind, source, conversationId, task, plan } = event;
          const current = stream.scope.conversationId === conversationId;
          this.event(stream, {
            kind,
            source,
            ...(task && current ? { task } : {}),
            ...(plan && current ? { plan } : {}),
          });
        } else this.event(stream, event);
      }
    });
    this.stopPauseObservation = storage.observePauseCounts((revision) => {
      for (const stream of this.streams.values()) {
        stream.pauseRevision = revision;
        this.event(stream, { kind: "pauseCounts", revision });
      }
    });
  }
  private event(stream: Stream, payload: ResearchEvent): void {
    if (this.streams.get(`${stream.window}/${stream.id}`) !== stream) return;
    this.emit({
      protocol: 1,
      policy: policyId,
      kind: "event",
      windowGeneration: stream.window,
      serviceGeneration: this.generation,
      subscriptionId: stream.id,
      sequence: ++stream.sequence,
      topic: "research",
      payload,
    });
  }
  sharedChange(
    event: Extract<ResearchEvent, { kind: "agentPreferenceChanged" | "providerModelsChanged" }>,
  ): void {
    for (const stream of this.streams.values()) this.event(stream, event);
  }
  connectionChanged(connection: string): void {
    for (const stream of this.streams.values())
      this.event(stream, { kind: "destinationChanged", connection });
  }
  reply(taskId: string, sequence: number, text: string): void {
    for (const stream of this.streams.values())
      if (stream.revisions.has(`timeline/${taskId}`))
        this.event(stream, { kind: "reply", taskId, sequence, text });
  }
  async publish(): Promise<void> {
    if (!this.streams.size) return;
    const pauses = await this.storage.readPauses();
    if (!pauses.ok) throw new Error("Pause counts could not be refreshed.");
    const running = await this.storage.runningTaskCount();
    if (!running.ok) throw new Error("Inference activity could not be refreshed.");
    for (const stream of this.streams.values()) {
      const result = await this.storage.researchRevisions(stream.scope);
      if (this.streams.get(`${stream.window}/${stream.id}`) !== stream) continue;
      if (!result.ok) throw new Error("Research revisions could not be refreshed.");
      if (stream.running !== running.value) {
        stream.running = running.value;
        this.event(stream, { kind: "inferenceActivity" });
      }
      if (stream.pauseRevision !== pauses.value.revision) {
        stream.pauseRevision = pauses.value.revision;
        this.event(stream, { kind: "pauseCounts", revision: pauses.value.revision });
      }
      for (const change of result.value) {
        const key = revisionKey(change);
        if ((stream.revisions.get(key) ?? 0) >= change.revision) continue;
        stream.revisions.set(key, change.revision);
        this.event(stream, change);
      }
    }
  }
  unsubscribe(window: string, subscription: string): void {
    this.streams.delete(`${window}/${subscription}`);
    this.staging.closeSubscription(window, subscription);
  }
  revokeWindow(window: string): void {
    for (const stream of this.streams.values())
      if (stream.window === window) this.unsubscribe(window, stream.id);
  }
  closeWindow(window: string): void {
    this.revokeWindow(window);
    this.staging.closeWindow(window);
  }
  dispose(): void {
    this.stopPauseObservation();
    this.stopActivityObservation();
    this.staging.dispose();
    this.streams.clear();
  }
  async dispatch(request: Request, cancelled?: () => boolean): Promise<boolean> {
    if (!isResearchOperation(request.operation)) return false;
    const respond = (payload: Outcome<unknown>, failureRecorded = false) => {
      this.storage.reportResearchPort(
        request.operation as import("@ohtia/contracts").ResearchOperation,
        payload,
        failureRecorded,
      );
      this.emit({ ...request, kind: "result", payload });
    };
    if (request.operation === "research.subscribe") {
      const p = request.payload;
      const key = `${request.windowGeneration}/${p.subscriptionId}`;
      if (
        [...this.streams.values()].some((stream) => stream.window === request.windowGeneration) ||
        this.streams.has(key)
      ) {
        respond(failure("busy"));
        return true;
      }
      const revisions = await this.storage.researchRevisions(p, false);
      if (!revisions.ok) {
        respond(revisions);
        return true;
      }
      if (cancelled?.()) {
        respond(failure("cancelled"));
        return true;
      }
      const pauses = await this.storage.readPauses();
      if (!pauses.ok) throw new Error("Pause counts could not be refreshed.");
      const running = await this.storage.runningTaskCount();
      if (!running.ok) {
        respond(running);
        return true;
      }
      if (cancelled?.()) {
        respond(failure("cancelled"));
        return true;
      }
      this.streams.set(key, {
        window: request.windowGeneration,
        id: p.subscriptionId,
        scope: { projectId: p.projectId, conversationId: p.conversationId },
        sequence: 0,
        running: running.value,
        pauseRevision: pauses.value.revision,
        revisions: new Map(revisions.value.map((change) => [revisionKey(change), change.revision])),
      });
      respond({ ok: true, value: { subscriptionId: p.subscriptionId } });
      return true;
    }
    if (request.operation === "text.part") {
      respond(this.staging.part(request.windowGeneration, request.operationId, request.payload));
      return true;
    }
    if (request.operation === "reply.readParts") {
      const found = await this.storage.researchTaskExists(request.payload.taskId);
      if (!found.ok || !found.value) {
        respond(found.ok ? failure("record_not_found") : found);
        return true;
      }
      const all = this.provider.replyParts(request.payload.taskId, request.payload.fromSequence);
      const parts = [];
      for (const part of all.parts) {
        if (
          !fitsResearchResult(request, {
            parts: [...parts, part],
            latestSequence: all.latestSequence,
          })
        )
          break;
        parts.push(part);
      }
      respond({ ok: true, value: { parts, latestSequence: all.latestSequence } });
      return true;
    }
    if (request.operation === "project.rename" || request.operation === "project.read") {
      const { projectId } = request.payload;
      if (
        ![...this.streams.values()].some(
          (stream) =>
            stream.window === request.windowGeneration && stream.scope.projectId === projectId,
        )
      ) {
        respond(failure("unauthorized"));
        return true;
      }
    }
    const scope = projectResearchScope(request);
    const scopeKey = scope && `${request.windowGeneration}/${scope.subscriptionId}`;
    const selected = scopeKey ? this.streams.get(scopeKey) : undefined;
    if (scope && selected?.scope.projectId !== scope.projectId) {
      respond(failure("unauthorized"));
      return true;
    }
    if (request.operation === "profile.stagePart" || request.operation === "manuscript.stagePart") {
      respond(
        this.staging.part(
          request.windowGeneration,
          request.operationId,
          request.payload,
          request.payload.subscriptionId,
        ),
      );
      return true;
    }
    if (request.operation === "manuscript.create" || request.operation === "manuscript.save") {
      const { operation, operationId, windowGeneration } = request;
      const { projectId, subscriptionId } = request.payload;
      const intent =
        request.operation === "manuscript.create"
          ? { kind: "create" as const, title: request.payload.title }
          : manuscriptSaveIntent(request.payload);
      const receipt = await this.storage.readResearchReceipt(
        operationId,
        operation,
        manuscriptIntentHash(projectId, intent),
      );
      if (scopeKey && this.streams.get(scopeKey) !== selected) {
        respond(failure("stale_generation"));
        return true;
      }
      if (!receipt.ok || receipt.value) {
        this.staging.discard(windowGeneration, operationId, subscriptionId);
        respond(receipt);
        return true;
      }
      if (request.operation === "manuscript.create") {
        respond(
          await this.storage.executeResearchCommand({
            command: request.operation,
            operationId,
            payload: { projectId, title: request.payload.title },
          }),
          true,
        );
        return true;
      }
      const { draftId, expectedRevisionId, saveReason, markdown } = request.payload;
      const text =
        typeof markdown === "string"
          ? { ok: true as const, value: markdown }
          : this.staging.take(windowGeneration, operationId, markdown, subscriptionId);
      this.staging.discard(windowGeneration, operationId, subscriptionId);
      if (!text.ok) {
        respond(text);
        return true;
      }
      respond(
        await this.storage.executeResearchCommand({
          command: request.operation,
          operationId,
          payload: { projectId, draftId, expectedRevisionId, saveReason, markdown: text.value },
        }),
        true,
      );
      return true;
    }
    if (isResearchMutation(request.operation)) {
      const stagePayload =
        request.operation === "stage.transition"
          ? stageTransitionPayload(request.payload)
          : undefined;
      let payload: unknown = stagePayload ?? request.payload;
      const payloadHash =
        request.operation === "profile.save"
          ? profileSaveHash(request.payload)
          : stagePayload
            ? stageTransitionHash(stagePayload)
            : createHash("sha256").update(canonicalJson(payload)).digest("hex");
      const receipt = await this.storage.readResearchReceipt(
        request.operationId,
        request.operation,
        payloadHash,
      );
      if (stagePayload && scopeKey && this.streams.get(scopeKey) !== selected) {
        respond(failure("stale_generation"));
        return true;
      }
      if (!receipt.ok || receipt.value) {
        this.staging.discard(request.windowGeneration, request.operationId, scope?.subscriptionId);
        respond(receipt);
        return true;
      }
      if (request.operation === "profile.save") {
        const { projectId, expectedRevision, patch, subscriptionId } = request.payload;
        let text = patch;
        if (typeof patch !== "string") {
          const staged = this.staging.take(
            request.windowGeneration,
            request.operationId,
            patch,
            subscriptionId,
          );
          if (!staged.ok) {
            respond(staged);
            return true;
          }
          text = staged.value;
        } else this.staging.discard(request.windowGeneration, request.operationId, subscriptionId);
        payload = { projectId, expectedRevision, patch: text };
      }
      if (request.operation === "message.append" || request.operation === "conversation.start") {
        if (typeof request.payload.content !== "string") {
          const text = this.staging.take(
            request.windowGeneration,
            request.operationId,
            request.payload.content,
          );
          if (!text.ok) {
            respond(text);
            return true;
          }
          payload = { ...request.payload, content: text.value };
        } else this.staging.discard(request.windowGeneration, request.operationId);
      }
      if (request.operation === "memory.add" || request.operation === "memory.edit") {
        if (typeof request.payload.text !== "string") {
          const text = this.staging.take(
            request.windowGeneration,
            request.operationId,
            request.payload.text,
          );
          if (!text.ok) {
            respond(text);
            return true;
          }
          payload = { ...request.payload, text: text.value };
        } else this.staging.discard(request.windowGeneration, request.operationId);
      }
      if (request.operation === "handoff.return") {
        if (typeof request.payload.selection !== "string") {
          const selection = this.staging.take(
            request.windowGeneration,
            request.operationId,
            request.payload.selection,
          );
          if (!selection.ok) {
            respond(selection);
            return true;
          }
          payload = { ...request.payload, selection: selection.value };
        } else this.staging.discard(request.windowGeneration, request.operationId);
      }
      const result = await this.storage.executeResearchCommand(
        {
          command: request.operation,
          operationId: request.operationId,
          payload,
        } as ResearchCommand,
        payloadHash,
      );
      respond(result, true);
      if (result.ok && request.operation === "agentPreference.replace") {
        const { target, expectedRevision } = request.payload;
        this.sharedChange({
          kind: "agentPreferenceChanged",
          source: "replace",
          target,
          revision: expectedRevision + 1,
        });
      }
      try {
        if (
          request.operation !== "project.rename" &&
          request.operation !== "profile.save" &&
          request.operation !== "stage.transition"
        )
          await this.provider.pump();
        await this.publish();
      } catch {
        this.providerFailure();
      }
      return true;
    }
    respond(await this.storage.readResearch(request));
    return true;
  }
}
