import {
  decodeStoredProfileContent,
  encodeProfileContent,
  failure,
  profileSchemaVersion,
  splitText,
  utf8Size,
  type FoundationPort,
  type PortCall,
  type ProfileField,
  type ProfileFields,
  type ProfileRevision,
  type ProfileSaveResult,
  type ResearchInputs,
} from "@ohtia/contracts";
import type { PendingWorkGuard, ProjectSelectionLease } from "./pending-project-work.js";
import { describeStagedText, stagedCommand } from "./staged-command.js";
import {
  draftFact,
  encodeDraft,
  sameFact,
  type FieldDraft,
  type ProfileDraft,
  type ProfileSection,
} from "./thesis-profile-fields.js";

type ProfilePort = Pick<
  FoundationPort,
  | "readThesisProfile"
  | "readThesisProfilePart"
  | "stageThesisProfilePart"
  | "saveThesisProfile"
  | "readThesisProfileReceipt"
>;
type ProjectScope = Pick<ResearchInputs["profile.read"], "projectId" | "subscriptionId">;
interface SavedProfile {
  readonly revision: ProfileRevision;
  readonly fields: ProfileFields;
}
interface SaveIntent {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly patch: string;
  readonly fields: ProfileFields;
}
type Notice =
  "invalid" | "tooLarge" | "conflict" | "saveFailed" | "uncertain" | "saved" | "refreshFailed";

interface ProfileState {
  readonly saved: SavedProfile | null | undefined;
  readonly draft: ProfileDraft;
  readonly busy: boolean;
  readonly reading: boolean;
  readonly readFailed: boolean;
  readonly conflict: boolean;
  readonly intent: SaveIntent | undefined;
  readonly notice: Notice | undefined;
  readonly invalid: readonly ProfileField[];
  /** The one section open for editing; its pending input stays in `draft`. */
  readonly editing: ProfileSection | undefined;
}

interface Binding {
  scope: ProjectScope | undefined;
  lastSubscriptionId: string | undefined;
  readonly lease: ProjectSelectionLease;
  readonly abort: AbortController;
}

function revisionNumber(profile: SavedProfile | null | undefined): number {
  return profile ? profile.revision.revision : 0;
}

/** Retains a project's unsaved input in this window and revokes every operation on scope change. */
export class ThesisProfileController {
  private binding: Binding | undefined;
  private observedRevision = 0;

  changed(revision: number): void {
    if (revision <= this.observedRevision) return;
    this.observedRevision = revision;
    if (revision > revisionNumber(this.state.saved)) void this.load();
  }
  private state: ProfileState = {
    saved: undefined,
    draft: {},
    busy: false,
    reading: false,
    readFailed: false,
    conflict: false,
    intent: undefined,
    notice: undefined,
    invalid: [],
    editing: undefined,
  };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly port: ProfilePort,
    private readonly nextId: () => string = () => crypto.randomUUID(),
  ) {}

  snapshot = (): ProfileState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ProfileState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  attach(lease: ProjectSelectionLease, subscriptionId?: string): () => void {
    this.binding?.abort.abort();
    this.observedRevision = 0;
    const binding: Binding = {
      scope: undefined,
      lastSubscriptionId: undefined,
      lease,
      abort: new AbortController(),
    };
    this.binding = binding;
    this.update({
      reading: false,
      busy: false,
      readFailed: false,
      ...(this.state.intent ? { notice: "uncertain" } : {}),
    });
    this.setSubscription(subscriptionId);
    return () => {
      binding.abort.abort();
      if (this.binding === binding) this.binding = undefined;
    };
  }

  /** The project's lease outlives replacement of its conversation subscription. */
  setSubscription(subscriptionId: string | undefined): void {
    const binding = this.binding;
    if (!this.current(binding) || binding.scope?.subscriptionId === subscriptionId) return;
    if (!subscriptionId) {
      binding.scope = undefined;
      return;
    }
    const replacing = binding.lastSubscriptionId !== undefined;
    binding.lastSubscriptionId = subscriptionId;
    binding.scope = { projectId: binding.lease.projectId, subscriptionId };
    this.observedRevision = 0;
    this.resume(replacing);
  }

  private resume(retry: boolean): void {
    if (this.state.busy || this.state.reading) return;
    if (this.state.intent) void this.reconcile(retry);
    else void this.load();
  }

  private current(binding: Binding | undefined): binding is Binding {
    return (
      !!binding &&
      this.binding === binding &&
      !binding.abort.signal.aborted &&
      binding.lease.isCurrent()
    );
  }

  clean = (): boolean => {
    return !this.state.busy && !this.state.intent && Object.keys(this.state.draft).length === 0;
  };

  discard = (): void => {
    if (this.state.busy || this.state.intent) return;
    this.update({ draft: {}, conflict: false, invalid: [], notice: undefined, editing: undefined });
  };

  /** Opens one section for editing while no other section holds pending input. */
  beginSection = (section: ProfileSection): boolean => {
    const { busy, intent, saved, editing, draft } = this.state;
    if (busy || intent || saved === undefined) return false;
    if (editing && editing !== section && Object.keys(draft).length) return false;
    if (editing !== section) this.update({ editing: section, notice: undefined });
    return true;
  };

  beforeDetach = (
    scope: Parameters<PendingWorkGuard>[0],
  ): Awaited<ReturnType<PendingWorkGuard>> => {
    if (!scope.isCurrent()) return { status: "keep_open" };
    return this.clean()
      ? { status: "safe_to_detach", isCurrent: () => scope.isCurrent() && this.clean() }
      : { status: this.state.busy ? "pending_confirmation" : "keep_open" };
  };

  edit = (field: ProfileField, edit: FieldDraft | undefined): void => {
    if (this.state.busy || this.state.intent || this.state.saved === undefined) return;
    const { [field]: previous, ...remaining } = this.state.draft;
    const changed = edit && !sameFact(draftFact(field, edit), this.state.saved?.fields[field]);
    if (!changed && !previous) return;
    this.update({
      draft: changed ? { ...remaining, [field]: edit } : remaining,
      invalid: this.state.invalid.filter((key) => key !== field),
      notice: this.state.conflict ? "conflict" : undefined,
    });
  };

  private async read(
    binding: Binding,
    scope: ProjectScope,
    revisionId: string | null,
  ): Promise<SavedProfile | null> {
    const { abort } = binding;
    const result = await this.call(binding, () =>
      this.port.readThesisProfile({ ...scope, revisionId }),
    );
    if (!result.ok) throw new Error("Thesis profile unavailable.");
    if (!result.value.profile) return null;
    const { content, ...revision } = result.value.profile;
    let text: string;
    if (typeof content === "string") text = content;
    else {
      text = "";
      for (let index = 1; index <= content.parts; index++) {
        if (binding.scope !== scope) throw new Error("Thesis profile observation changed.");
        const part = await this.call(binding, () =>
          this.port.readThesisProfilePart({ ...scope, revisionId: revision.revisionId, index }),
        );
        if (!part.ok) throw new Error("Thesis profile part unavailable.");
        text += part.value.text;
      }
      const descriptor = await describeStagedText(text, content.parts);
      if (
        typeof descriptor === "string" ||
        descriptor.sha256 !== content.sha256 ||
        utf8Size(text) !== content.bytes
      )
        throw new Error("Thesis profile text integrity failed.");
    }
    abort.signal.throwIfAborted();
    const decoded = decodeStoredProfileContent(text);
    if (!decoded) throw new Error("Invalid saved thesis profile.");
    return { revision, fields: decoded.fields };
  }

  private async call<T>(binding: Binding, request: () => PortCall<T>) {
    if (!this.current(binding)) return failure("stale_generation");
    const { signal } = binding.abort;
    const call = request();
    const cancel = () => {
      call.cancel();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await call.result;
      return this.current(binding) ? result : failure("stale_generation");
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  load = async (compareLatest = false): Promise<void> => {
    const binding = this.binding;
    if (
      !this.current(binding) ||
      !binding.scope ||
      this.state.busy ||
      this.state.reading ||
      this.state.intent
    )
      return;
    const scope = binding.scope;
    const observed = this.observedRevision;
    let changedDuringRead = false;
    this.update({ reading: true, readFailed: false });
    try {
      const saved = await this.read(binding, scope, null);
      if (!this.current(binding) || binding.scope !== scope) return;
      changedDuringRead = this.observedRevision > Math.max(observed, revisionNumber(saved));
      if (changedDuringRead) return;
      const changed = revisionNumber(saved) !== revisionNumber(this.state.saved);
      if (changed && Object.keys(this.state.draft).length && !compareLatest) {
        this.update({ conflict: true, notice: "conflict" });
      } else {
        this.update({ saved, conflict: false, notice: undefined });
      }
    } catch {
      if (this.current(binding) && binding.scope === scope) this.update({ readFailed: true });
    } finally {
      if (this.current(binding)) {
        this.update({ reading: false });
        if (binding.scope !== scope) this.resume(true);
        else if (changedDuringRead) void this.load(compareLatest);
      }
    }
  };

  save = async (): Promise<void> => {
    const binding = this.binding;
    const { busy, reading, conflict, draft, intent, saved } = this.state;
    if (
      !this.current(binding) ||
      !binding.scope ||
      busy ||
      reading ||
      conflict ||
      intent ||
      saved === undefined ||
      !Object.keys(draft).length
    )
      return;
    const { fields, invalid } = encodeDraft(draft);
    if (invalid.length) {
      this.update({ invalid, notice: "invalid" });
      return;
    }
    let patch: string;
    const previousFields = saved ? saved.fields : {};
    const merged = { ...previousFields, ...fields };
    try {
      patch = encodeProfileContent({ schemaVersion: profileSchemaVersion, fields });
      encodeProfileContent({ schemaVersion: profileSchemaVersion, fields: merged });
    } catch {
      this.update({ notice: "tooLarge" });
      return;
    }
    const scope = binding.scope;
    const next = {
      operationId: this.nextId(),
      expectedRevision: revisionNumber(saved),
      patch,
      fields: merged,
    };
    this.update({ intent: next, busy: true, notice: undefined });
    await this.send(binding, scope, next);
  };

  reconcile = async (retry = false): Promise<void> => {
    const binding = this.binding;
    const { intent, busy } = this.state;
    if (!this.current(binding) || !binding.scope || !intent || busy) return;
    const scope = binding.scope;
    this.update({ busy: true });
    try {
      const patch = await describeStagedText(intent.patch, splitText(intent.patch).length);
      if (binding.scope !== scope) {
        this.interrupted(binding, scope);
        return;
      }
      const receipt = await this.call(binding, () =>
        this.port.readThesisProfileReceipt({
          ...scope,
          operationId: intent.operationId,
          expectedRevision: intent.expectedRevision,
          patch,
        }),
      );
      if (!this.current(binding)) return;
      if (receipt.ok && receipt.value.receipt) {
        await this.confirm(intent, receipt.value.receipt);
      } else if (binding.scope !== scope) {
        this.interrupted(binding, scope);
      } else if (receipt.ok && retry) {
        await this.send(binding, scope, intent);
      } else if (
        !receipt.ok &&
        ["operation_conflict", "record_not_found", "project_in_setup"].includes(receipt.error.code)
      ) {
        this.update({ intent: undefined, busy: false, notice: "saveFailed" });
      } else {
        this.update({ busy: false, notice: "uncertain" });
      }
    } catch {
      this.interrupted(binding, scope);
    }
  };

  private interrupted(binding: Binding, scope: ProjectScope): void {
    if (!this.current(binding)) return;
    this.update({ busy: false, notice: "uncertain" });
    if (binding.scope && binding.scope !== scope) this.resume(true);
  }

  private async send(binding: Binding, scope: ProjectScope, intent: SaveIntent): Promise<void> {
    const scoped = <T>(send: () => PortCall<T>): PortCall<T> => ({
      result:
        binding.scope === scope
          ? this.call(binding, send)
          : Promise.resolve(failure("stale_generation")),
      cancel() {},
    });
    const result = await stagedCommand(
      {
        sendTextPart: (id, part) =>
          scoped(() => this.port.stageThesisProfilePart(id, { ...scope, ...part })),
      },
      intent.operationId,
      intent.patch,
      (patch) =>
        scoped(() =>
          this.port.saveThesisProfile(intent.operationId, {
            ...scope,
            expectedRevision: intent.expectedRevision,
            patch,
          }),
        ),
    );
    if (!this.current(binding)) return;
    if (result.ok) {
      await this.confirm(intent, result.value);
      return;
    }
    const { code } = result.error;
    if (
      binding.scope !== scope &&
      ["unauthorized", "stale_generation", "parts_incomplete"].includes(code)
    ) {
      this.interrupted(binding, scope);
      return;
    }
    const uncertain = [
      "uncertain",
      "invalid_service_result",
      "stale_generation",
      "service_unavailable",
      "cancelled",
      "timeout",
      "disposed",
    ].includes(code);
    this.update({
      intent: uncertain ? intent : undefined,
      busy: false,
      conflict: code === "stale_revision",
      notice: uncertain
        ? "uncertain"
        : code === "stale_revision"
          ? "conflict"
          : code === "limit_reached"
            ? "tooLarge"
            : "saveFailed",
    });
    if (uncertain && binding.scope && binding.scope !== scope) this.resume(true);
  }

  private async confirm(intent: SaveIntent, result: ProfileSaveResult): Promise<void> {
    const saved = { revision: result.profileChange.revision, fields: intent.fields };
    this.update({
      saved,
      draft: {},
      intent: undefined,
      busy: false,
      notice: "saved",
      editing: undefined,
    });
    await this.refreshSaved();
  }

  refreshSaved = async (): Promise<void> => {
    const binding = this.binding;
    const { saved, busy, reading } = this.state;
    if (!this.current(binding) || !binding.scope || !saved || busy || reading) return;
    const scope = binding.scope;
    this.update({ reading: true, readFailed: false });
    try {
      const exact = await this.read(binding, scope, saved.revision.revisionId);
      if (!exact) throw new Error("Confirmed profile revision unavailable.");
      if (this.current(binding) && binding.scope === scope)
        this.update({ saved: exact, notice: "saved" });
    } catch {
      if (this.current(binding) && binding.scope === scope)
        this.update({ notice: "refreshFailed" });
    } finally {
      if (this.current(binding)) {
        this.update({ reading: false });
        if (binding.scope !== scope) this.resume(true);
        else if (this.observedRevision > revisionNumber(this.state.saved)) void this.load();
      }
    }
  };
}
