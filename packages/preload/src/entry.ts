import { isExternalMessageLink } from "@ohtia/contracts";
import { contextBridge, ipcRenderer } from "electron";
import {
  decodeDiagnosticBundleRequest,
  decodeDiagnosticBundleResult,
  decodeDiagnosticDeleteRequest,
  decodeDiagnosticDeleteResult,
  type DiagnosticDeleteResult,
  decodeDiagnosticReadRequest,
  decodeDiagnosticReadResult,
  decodeBootstrapSnapshot,
  isExitChoice,
  isExitDialogState,
  isManuscriptLockRequest,
  type ManuscriptLockRequest,
  type ExitDialogState,
  decodeSystemMotionNotice,
  decodeUpdateStateNotice,
  isCommandContext,
  isCommandIntent,
  isWindowCommandRequest,
  isWindowCommandResult,
  isCommandSnapshot,
  isAboutInformation,
  isUpdateRoute,
  isNativeCommand,
  isInterfaceLocale,
  projectLinks,
  desktopChannels,
  isIdentifier,
  isCanonicalUuid,
  failure,
  portLimits,
  type ConnectionEvent,
  type ResearchScope,
  type ResearchEvent,
  type LocaleSnapshot,
  type PresentationSnapshot,
  type Outcome,
  type Subscription,
  type BootstrapAction,
  type DesktopBridge,
  type SystemMotion,
  type SystemMotionNotice,
  type UpdateStateNotice,
} from "@ohtia/contracts";
import { createFoundationPort } from "./foundation-port.js";

function connect() {
  const session: unknown = ipcRenderer.sendSync(desktopChannels.session);
  if (!session || typeof session !== "object") throw new Error("Desktop session unavailable.");
  const fields = session as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !== "serviceGeneration,windowGeneration" ||
    !isIdentifier(fields.windowGeneration) ||
    !isIdentifier(fields.serviceGeneration)
  )
    throw new Error("Invalid desktop session.");
  return {
    generation: fields.serviceGeneration,
    client: createFoundationPort(
      { contextIsolated: process.contextIsolated, sandboxed: process.sandboxed },
      {
        send: (text) => {
          ipcRenderer.send(desktopChannels.port, text);
        },
        listen: (receive) => {
          const listener = (_event: unknown, text: unknown) => {
            receive(text);
          };
          ipcRenderer.on(desktopChannels.reply, listener);
          return () => {
            ipcRenderer.removeListener(desktopChannels.reply, listener);
          };
        },
      },
      {
        after: (ms, callback) => {
          const timer = setTimeout(callback, ms);
          return () => {
            clearTimeout(timer);
          };
        },
      },
      {
        windowGeneration: fields.windowGeneration,
        serviceGeneration: fields.serviceGeneration,
        nextId: () => crypto.randomUUID(),
      },
    ),
  };
}
let connection = connect();
const connectionOwners = new Set<{
  listener: (notice: Outcome<ConnectionEvent>) => void;
  dispose(): void;
}>();
function subscribeConnection(
  id: string,
  listener: (notice: Outcome<ConnectionEvent>) => void,
): Subscription {
  if (connectionOwners.size >= portLimits.subscriptions_per_window)
    return { ready: Promise.resolve(failure("busy")), dispose() {} };
  const lifetime: { active: boolean; stream?: Subscription } = { active: true };
  const owner = {
    listener,
    dispose() {
      lifetime.active = false;
      connectionOwners.delete(owner);
      lifetime.stream?.dispose();
    },
  };
  const stream = connection.client.port.subscribeConnection(id, (notice) => {
    if (!notice.ok) owner.dispose();
    try {
      listener(notice);
    } catch {
      owner.dispose();
    }
  });
  lifetime.stream = stream;
  if (lifetime.active) connectionOwners.add(owner);
  else stream.dispose();
  void stream.ready.then((outcome) => {
    if (!outcome.ok) owner.dispose();
  });
  return {
    ready: stream.ready,
    dispose: () => {
      owner.dispose();
    },
  };
}
const researchOwners = new Set<{
  listener: (notice: Outcome<ResearchEvent>) => void;
  dispose(): void;
}>();
function subscribeResearch(
  scope: ResearchScope,
  listener: (notice: Outcome<ResearchEvent>) => void,
): Subscription {
  const stream = connection.client.port.subscribeResearch(scope, listener);
  const owner = {
    listener,
    dispose() {
      researchOwners.delete(owner);
      stream.dispose();
    },
  };
  researchOwners.add(owner);
  void stream.ready.then((outcome) => {
    if (!outcome.ok) owner.dispose();
  });
  return {
    ready: stream.ready,
    dispose: () => {
      owner.dispose();
    },
  };
}
// Retain only bounded logical locale owners across private connection replacement.
const localeOwners = new Set<{
  listener: (notice: Outcome<LocaleSnapshot> | Outcome<PresentationSnapshot>) => void;
  stream: Subscription;
}>();
function subscribeLocale(listener: (notice: Outcome<LocaleSnapshot>) => void): Subscription {
  if (localeOwners.size >= portLimits.subscriptions_per_window)
    return { ready: Promise.resolve(failure("busy")), dispose() {} };
  const stream = connection.client.port.subscribeLocale(listener);
  const owner = {
    listener: listener as (notice: Outcome<LocaleSnapshot> | Outcome<PresentationSnapshot>) => void,
    stream,
  };
  localeOwners.add(owner);
  return {
    ready: stream.ready,
    dispose() {
      localeOwners.delete(owner);
      stream.dispose();
    },
  };
}
function subscribePresentation(
  listener: (notice: Outcome<PresentationSnapshot>) => void,
): Subscription {
  if (localeOwners.size >= portLimits.subscriptions_per_window)
    return { ready: Promise.resolve(failure("busy")), dispose() {} };
  const stream = connection.client.port.subscribePresentation(listener);
  const owner = {
    listener: listener as (notice: Outcome<LocaleSnapshot> | Outcome<PresentationSnapshot>) => void,
    stream,
  };
  localeOwners.add(owner);
  return {
    ready: stream.ready,
    dispose() {
      localeOwners.delete(owner);
      stream.dispose();
    },
  };
}
const preferencesReady = (_event: unknown, generation: unknown) => {
  if (generation !== connection.generation) return;
  for (const owner of [...localeOwners]) {
    try {
      owner.listener(failure("sequence_gap"));
    } catch {
      localeOwners.delete(owner);
      owner.stream.dispose();
    }
  }
};
ipcRenderer.on(desktopChannels.preferencesReady, preferencesReady);
async function bootstrap(action: BootstrapAction, verification?: string) {
  const result: unknown = await ipcRenderer.invoke(
    desktopChannels.bootstrap,
    action,
    ...(verification === undefined ? [] : [verification]),
  );
  const snapshot = decodeBootstrapSnapshot(result);
  if (!snapshot) throw new Error("Invalid bootstrap response.");
  return snapshot;
}
const commandListeners = new Set<Parameters<DesktopBridge["commands"]["onIntent"]>[0]>();
let commandContext: Awaited<ReturnType<DesktopBridge["commands"]["context"]>> | undefined;
const commandIntent = (_event: unknown, input: unknown) => {
  if (
    !isCommandIntent(input) ||
    input.source !== "native" ||
    input.windowGeneration !== commandContext?.windowGeneration
  )
    return;
  for (const listener of commandListeners) {
    try {
      listener(input);
    } catch {
      commandListeners.delete(listener);
    }
  }
};
ipcRenderer.on(desktopChannels.commandIntent, commandIntent);
// Sequenced notices let the synchronous initial read and earlier queued pushes arrive in any order.
const motionListeners = new Set<(value: SystemMotion) => void>();
let motion: SystemMotionNotice = { sequence: -1, value: "unknown" };
function acceptMotion(input: unknown): void {
  const notice = decodeSystemMotionNotice(input);
  if (!notice || notice.sequence <= motion.sequence) return;
  const changed = notice.value !== motion.value;
  motion = notice;
  if (!changed) return;
  for (const listener of [...motionListeners]) {
    try {
      listener(notice.value);
    } catch {
      motionListeners.delete(listener);
    }
  }
}
const systemMotion = (_event: unknown, input: unknown) => {
  acceptMotion(input);
};
ipcRenderer.on(desktopChannels.systemMotion, systemMotion);
acceptMotion(ipcRenderer.sendSync(desktopChannels.systemMotion));
// Main numbers its update states; a stale or repeated push never reaches a listener.
const updateListeners = new Set<(notice: UpdateStateNotice) => void>();
let updateSequence = -1;
const updateState = (_event: unknown, input: unknown) => {
  const notice = decodeUpdateStateNotice(input);
  if (!notice || notice.sequence <= updateSequence) return;
  updateSequence = notice.sequence;
  for (const listener of [...updateListeners]) {
    try {
      listener(notice);
    } catch {
      updateListeners.delete(listener);
    }
  }
};
ipcRenderer.on(desktopChannels.updateState, updateState);
async function commandBoolean(action: string, payload: unknown): Promise<boolean> {
  const value: unknown = await ipcRenderer.invoke(desktopChannels.commands, action, payload);
  return value === true;
}
const exitListeners = new Set<(state: ExitDialogState | null) => void>();
ipcRenderer.on(desktopChannels.exitState, (_event, input: unknown) => {
  if (input !== null && !isExitDialogState(input)) return;
  for (const listener of [...exitListeners]) {
    try {
      listener(input);
    } catch {
      exitListeners.delete(listener);
    }
  }
});
const manuscriptCloseListeners = new Set<
  NonNullable<Parameters<NonNullable<DesktopBridge["commands"]["onManuscriptClose"]>>[0]>
>();
ipcRenderer.on(desktopChannels.manuscriptClose, (_event, command: unknown) => {
  if (command !== "window.close" && command !== "application.quit") return;
  for (const listener of manuscriptCloseListeners) {
    try {
      listener(command);
    } catch {
      manuscriptCloseListeners.delete(listener);
    }
  }
});
const manuscriptLockListeners = new Set<
  NonNullable<Parameters<NonNullable<DesktopBridge["commands"]["onManuscriptLock"]>>[0]>
>();
// The active lock reaches a manuscript surface that subscribes after the request arrived.
let activeManuscriptLock: ManuscriptLockRequest | undefined;
ipcRenderer.on(desktopChannels.manuscriptLock, (_event, request: unknown) => {
  if (!isManuscriptLockRequest(request)) return;
  activeManuscriptLock = request.locked ? request : undefined;
  // A window without a manuscript surface holds no manuscript text and confirms at once.
  if (request.locked && manuscriptLockListeners.size === 0) {
    void commandBoolean("manuscript_locked", { id: request.id, pending: false }).catch(() => {});
    return;
  }
  for (const listener of manuscriptLockListeners) {
    try {
      listener(request);
    } catch {
      manuscriptLockListeners.delete(listener);
    }
  }
});
const bridge: DesktopBridge = {
  commands: {
    setManuscriptPending: (pending) =>
      typeof pending === "boolean"
        ? commandBoolean("manuscript_pending", pending)
        : Promise.resolve(false),
    onManuscriptClose(listener) {
      if (manuscriptCloseListeners.size >= portLimits.subscriptions_per_window)
        throw new Error("Manuscript close listener limit reached.");
      manuscriptCloseListeners.add(listener);
      return () => {
        manuscriptCloseListeners.delete(listener);
      };
    },
    onManuscriptLock(listener) {
      if (manuscriptLockListeners.size >= portLimits.subscriptions_per_window)
        throw new Error("Manuscript lock listener limit reached.");
      manuscriptLockListeners.add(listener);
      const active = activeManuscriptLock;
      if (active)
        queueMicrotask(() => {
          if (!manuscriptLockListeners.has(listener) || activeManuscriptLock !== active) return;
          try {
            listener(active);
          } catch {
            manuscriptLockListeners.delete(listener);
          }
        });
      return () => {
        manuscriptLockListeners.delete(listener);
      };
    },
    confirmManuscriptLock: (id, pending) =>
      typeof id === "string" && typeof pending === "boolean"
        ? commandBoolean("manuscript_locked", { id, pending })
        : Promise.resolve(false),
    async readExitState() {
      const value: unknown = await ipcRenderer.invoke(
        desktopChannels.commands,
        "exit_state",
        undefined,
      );
      if (value !== null && !isExitDialogState(value)) throw new Error("Invalid exit state.");
      return value;
    },
    onExitState(listener) {
      if (exitListeners.size >= portLimits.subscriptions_per_window)
        throw new Error("Exit listener limit reached.");
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },
    chooseExit: (operationId, choice) =>
      isIdentifier(operationId) && isExitChoice(choice)
        ? commandBoolean("exit_choice", { operationId, choice })
        : Promise.resolve(false),
    async windowAction(request) {
      if (
        !isWindowCommandRequest(request) ||
        request.intent.windowGeneration !== commandContext?.windowGeneration
      )
        return { status: "stale_context" };
      const result: unknown = await ipcRenderer.invoke(
        desktopChannels.commands,
        "window_action",
        request,
      );
      return isWindowCommandResult(result) ? result : { status: "failed" };
    },
    async context() {
      const value: unknown = await ipcRenderer.invoke(
        desktopChannels.commands,
        "context",
        undefined,
      );
      if (!isCommandContext(value)) throw new Error("Invalid command context.");
      commandContext = value;
      return value;
    },
    publish: (snapshot) =>
      isCommandSnapshot(snapshot) && snapshot.windowGeneration === commandContext?.windowGeneration
        ? commandBoolean("publish", snapshot)
        : Promise.resolve(false),
    onIntent(listener) {
      if (commandListeners.size >= portLimits.subscriptions_per_window)
        throw new Error("Command listener limit reached.");
      commandListeners.add(listener);
      return () => {
        commandListeners.delete(listener);
      };
    },
    async about() {
      const value: unknown = await ipcRenderer.invoke(desktopChannels.commands, "about", undefined);
      if (!isAboutInformation(value)) throw new Error("Invalid About information.");
      return value;
    },
    async updateRoute() {
      const value: unknown = await ipcRenderer.invoke(
        desktopChannels.commands,
        "update_route",
        undefined,
      );
      if (!isUpdateRoute(value)) throw new Error("Invalid update route.");
      return value;
    },
    openUpdateRoute: () => commandBoolean("open_update_route", undefined),
    copyVersionInformation: (locale) =>
      isInterfaceLocale(locale) ? commandBoolean("copy_version", locale) : Promise.resolve(false),
    perform: (command) =>
      isNativeCommand(command) ? commandBoolean("perform", command) : Promise.resolve(false),
    openExternalLink: (url) =>
      isExternalMessageLink(url)
        ? commandBoolean("open_external_link", url)
        : Promise.resolve(false),
    copyMessage: (messageId) =>
      isIdentifier(messageId) ? commandBoolean("copy_message", messageId) : Promise.resolve(false),
    openLink: (link) =>
      typeof link === "string" && Object.hasOwn(projectLinks, link)
        ? commandBoolean("open_link", link)
        : Promise.resolve(false),
    openNoticeLink: (component) =>
      typeof component === "string" && component.length > 0 && component.length <= 65536
        ? commandBoolean("open_notice_link", component)
        : Promise.resolve(false),
  },
  system: {
    readMotion: () => motion.value,
    subscribeMotion(listener) {
      if (typeof listener !== "function") throw new TypeError("Invalid system motion listener.");
      if (motionListeners.size >= portLimits.subscriptions_per_window)
        throw new Error("System motion listener limit reached.");
      motionListeners.add(listener);
      return () => {
        motionListeners.delete(listener);
      };
    },
  },
  diagnostics: {
    async bundle(request) {
      const input = decodeDiagnosticBundleRequest(request);
      if (!input) return { status: "invalid_request" };
      const failure = input.action === "save" ? "uncertain" : "unavailable";
      try {
        const result: unknown = await ipcRenderer.invoke(desktopChannels.diagnosticsBundle, input);
        const decoded = decodeDiagnosticBundleResult(result);
        if (!decoded) return { status: failure };
        switch (decoded.status) {
          case "preview":
          case "too_large":
          case "invalid_file":
            return input.action === "prepare" ? decoded : { status: failure };
          case "saved":
          case "uncertain":
            return input.action === "save" ? decoded : { status: failure };
          case "cancelled":
            return input.action === "prepare" ? { status: failure } : decoded;
          default:
            return decoded;
        }
      } catch {
        return { status: failure };
      }
    },
    async readPage(request) {
      const input = decodeDiagnosticReadRequest(request);
      if (!input) return { status: "invalid_request" };
      try {
        const result: unknown = await ipcRenderer.invoke(desktopChannels.diagnosticsRead, input);
        return decodeDiagnosticReadResult(result) ?? { status: "unavailable" };
      } catch {
        return { status: "unavailable" };
      }
    },
    async deleteLogs(request) {
      const input = decodeDiagnosticDeleteRequest(request);
      if (!input) return { status: "invalid_request" };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          ipcRenderer
            .invoke(desktopChannels.diagnosticsDelete, input)
            .then<DiagnosticDeleteResult>(
              (result: unknown) => decodeDiagnosticDeleteResult(result) ?? { status: "uncertain" },
            ),
          new Promise<DiagnosticDeleteResult>((resolve) => {
            timer = setTimeout(() => {
              resolve({ status: "uncertain" });
            }, portLimits.request_deadline_ms);
          }),
        ]);
      } catch {
        return { status: "uncertain" };
      } finally {
        clearTimeout(timer);
      }
    },
  },
  update: {
    subscribeState(listener) {
      if (typeof listener !== "function") throw new TypeError("Invalid update state listener.");
      if (updateListeners.size >= portLimits.subscriptions_per_window)
        throw new Error("Update state listener limit reached.");
      updateListeners.add(listener);
      return () => {
        updateListeners.delete(listener);
      };
    },
  },
  foundation: {
    readUpdateCheck: () => connection.client.port.readUpdateCheck(),
    replaceUpdateCheck: (change, generation) =>
      connection.client.port.replaceUpdateCheck(change, generation),
    readUpdateCheckReceipt: (id) => connection.client.port.readUpdateCheckReceipt(id),
    readUpdate: () => connection.client.port.readUpdate(),
    checkForUpdate: () => connection.client.port.checkForUpdate(),
    readExecutionLimits: () => connection.client.port.readExecutionLimits(),
    replaceExecutionLimits: (change, generation) =>
      connection.client.port.replaceExecutionLimits(change, generation),
    readExecutionLimitsReceipt: (id) => connection.client.port.readExecutionLimitsReceipt(id),
    createProject: (id) => connection.client.port.createProject(id),
    openProject: (id, input) => connection.client.port.openProject(id, input),
    renameProject: (id, input) => connection.client.port.renameProject(id, input),
    listManuscripts: (input) => connection.client.port.listManuscripts(input),
    readManuscript: (input) => connection.client.port.readManuscript(input),
    readManuscriptPart: (input) => connection.client.port.readManuscriptPart(input),
    stageManuscriptPart: (id, input) => connection.client.port.stageManuscriptPart(id, input),
    createManuscript: (id, input) => connection.client.port.createManuscript(id, input),
    saveManuscript: (id, input) => connection.client.port.saveManuscript(id, input),
    readManuscriptReceipt: (input) => connection.client.port.readManuscriptReceipt(input),
    readResearchStage: (input) => connection.client.port.readResearchStage(input),
    readStageDecision: (input) => connection.client.port.readStageDecision(input),
    transitionResearchStage: (id, input) =>
      connection.client.port.transitionResearchStage(id, input),
    readStageReceipt: (input) => connection.client.port.readStageReceipt(input),
    readThesisProfile: (input) => connection.client.port.readThesisProfile(input),
    readThesisProfilePart: (input) => connection.client.port.readThesisProfilePart(input),
    stageThesisProfilePart: (id, input) => connection.client.port.stageThesisProfilePart(id, input),
    saveThesisProfile: (id, input) => connection.client.port.saveThesisProfile(id, input),
    readThesisProfileReceipt: (input) => connection.client.port.readThesisProfileReceipt(input),
    readProject: (input) => connection.client.port.readProject(input),
    confirmProjectSetup: (id, input) => connection.client.port.confirmProjectSetup(id, input),
    rejectProjectSetup: (id, input) => connection.client.port.rejectProjectSetup(id, input),
    startConversation: (id, input) => connection.client.port.startConversation(id, input),
    renameConversation: (id, input) => connection.client.port.renameConversation(id, input),
    stopConversation: (id, input) => connection.client.port.stopConversation(id, input),
    readPauses: () => connection.client.port.readPauses(),
    cancelPlan: (id, input) => connection.client.port.cancelPlan(id, input),
    readPlanChange: (input) => connection.client.port.readPlanChange(input),
    addMemory: (id, input) => connection.client.port.addMemory(id, input),
    editMemory: (id, input) => connection.client.port.editMemory(id, input),
    withdrawMemory: (id, input) => connection.client.port.withdrawMemory(id, input),
    listMemory: (input) => connection.client.port.listMemory(input),
    readMemoryHistory: (input) => connection.client.port.readMemoryHistory(input),
    undoMemory: (id, input) => connection.client.port.undoMemory(id, input),
    applyPlanChange: (id, input) => connection.client.port.applyPlanChange(id, input),
    declinePlanChange: (id, input) => connection.client.port.declinePlanChange(id, input),
    acceptPlan: (id, input) => connection.client.port.acceptPlan(id, input),
    declinePlan: (id, input) => connection.client.port.declinePlan(id, input),
    readPlan: (input) => connection.client.port.readPlan(input),
    acceptHandoff: (id, input) => connection.client.port.acceptHandoff(id, input),
    declineHandoff: (id, input) => connection.client.port.declineHandoff(id, input),
    returnHandoff: (id, input) => connection.client.port.returnHandoff(id, input),
    listHandoffSelection: (input) => connection.client.port.listHandoffSelection(input),
    listPlanEvents: (input) => connection.client.port.listPlanEvents(input),
    finishPlan: (id, input) => connection.client.port.finishPlan(id, input),
    acceptConsultation: (id, input) => connection.client.port.acceptConsultation(id, input),
    declineConsultation: (id, input) => connection.client.port.declineConsultation(id, input),
    tryAgainContribution: (id, input) => connection.client.port.tryAgainContribution(id, input),
    startAgainContribution: (id, input) => connection.client.port.startAgainContribution(id, input),
    tryAgainSynthesis: (id, input) => connection.client.port.tryAgainSynthesis(id, input),
    tryAgainTask: (id, input) => connection.client.port.tryAgainTask(id, input),
    startAgainTask: (id, input) => connection.client.port.startAgainTask(id, input),
    resumeUsagePause: (id, input) => connection.client.port.resumeUsagePause(id, input),
    continueAllTasks: (id) => connection.client.port.continueAllTasks(id),
    stopTask: (id, input) => connection.client.port.stopTask(id, input),
    readDestination: (input) => connection.client.port.readDestination(input),
    appendMessage: (id, input) => connection.client.port.appendMessage(id, input),
    listProjectAttention: (input) => connection.client.port.listProjectAttention(input),
    listProjects: (input) => connection.client.port.listProjects(input),
    listConversations: (input) => connection.client.port.listConversations(input),
    readConversations: (input) => connection.client.port.readConversations(input),
    listTimelineBefore: (input) => connection.client.port.listTimelineBefore(input),
    readTimeline: (input) => connection.client.port.readTimeline(input),
    sendTextPart: (id, input) => connection.client.port.sendTextPart(id, input),
    readTextPart: (input) => connection.client.port.readTextPart(input),
    listAgentPreferences: (operationId) => connection.client.port.listAgentPreferences(operationId),
    replaceAgentPreference: (id, input) => connection.client.port.replaceAgentPreference(id, input),
    listProviderModels: (input) => connection.client.port.listProviderModels(input),
    readReplyDetails: (input) => connection.client.port.readReplyDetails(input),
    readReplyParts: (input) => connection.client.port.readReplyParts(input),
    subscribeResearch,

    readConnection: (id) => connection.client.port.readConnection(id),
    connectConnection: (id, options) => connection.client.port.connectConnection(id, options),
    replaceConnectionKey: (id, key) => connection.client.port.replaceConnectionKey(id, key),
    disconnectConnection: (id) => connection.client.port.disconnectConnection(id),
    probeConnection: (id) => connection.client.port.probeConnection(id),
    listConnectionModels: (input) => connection.client.port.listConnectionModels(input),
    subscribeConnection,
    readPresentation: () => connection.client.port.readPresentation(),
    subscribePresentation,
    replaceSourceQuote: (change, generation) =>
      connection.client.port.replaceSourceQuote(change, generation),
    readSourceQuoteReceipt: (id) => connection.client.port.readSourceQuoteReceipt(id),
    replaceEntryText: (change, generation) =>
      connection.client.port.replaceEntryText(change, generation),
    readEntryTextReceipt: (id) => connection.client.port.readEntryTextReceipt(id),
    replaceCharacter: (change, generation) =>
      connection.client.port.replaceCharacter(change, generation),
    readCharacterReceipt: (id) => connection.client.port.readCharacterReceipt(id),
    replaceZoom: (change, generation) => connection.client.port.replaceZoom(change, generation),
    adjustZoom: (id, intent, generation) =>
      connection.client.port.adjustZoom(id, intent, generation),
    readZoomReceipt: (id) => connection.client.port.readZoomReceipt(id),
    applyZoom: () => connection.client.port.applyZoom(),
    readLocale: () => connection.client.port.readLocale(),
    replaceLocale: (change, expectedServiceGeneration) =>
      connection.client.port.replaceLocale(change, expectedServiceGeneration),
    readLocaleReceipt: (operation) => connection.client.port.readLocaleReceipt(operation),
    subscribeLocale,
    claimLayoutFailureNotice: () => connection.client.port.claimLayoutFailureNotice(),
    readLayout: () => connection.client.port.readLayout(),
    replaceLayout: (change) => connection.client.port.replaceLayout(change),
    readLayoutReceipt: (operation) => connection.client.port.readLayoutReceipt(operation),
    readStatus: () => connection.client.port.readStatus(),
    readManagedStoreLocation: () => connection.client.port.readManagedStoreLocation(),
    readAppearance: () => connection.client.port.readAppearance(),
    readAppearanceReceipt: (operation) => connection.client.port.readAppearanceReceipt(operation),
    replaceAppearance: (change, generation) =>
      connection.client.port.replaceAppearance(change, generation),
    subscribeStatus: (listener) => connection.client.port.subscribeStatus(listener),
    subscribeAppearance: (listener) => connection.client.port.subscribeAppearance(listener),
  },
  bootstrap: {
    read: () => bootstrap("read"),
    retryService: () => bootstrap("retry_service"),
    newWindow: () => bootstrap("new_window"),
    exit: () => bootstrap("exit"),
    restoreCheckpoint: async (verification) => {
      if (!isCanonicalUuid(verification)) throw new Error("Invalid checkpoint verification.");
      return bootstrap("restore_checkpoint", verification);
    },
    openStorage: () => bootstrap("open_storage"),
  },
};
contextBridge.exposeInMainWorld("ohtia", bridge);
const serviceEnded = (_event: unknown, ended: unknown) => {
  if (ended === connection.generation) connection.client.dispose();
};
ipcRenderer.on(desktopChannels.ended, serviceEnded);
const reconnect = () => {
  connection.client.dispose();
  connection = connect();
  for (const owner of [...researchOwners]) {
    owner.dispose();
    try {
      owner.listener(failure("sequence_gap"));
    } catch {
      /* A consumer cannot interrupt reconnection. */
    }
  }
  for (const owner of [...connectionOwners]) {
    owner.dispose();
    try {
      owner.listener(failure("sequence_gap"));
    } catch {
      /* Consumer cannot interrupt reconnect. */
    }
  }
};
ipcRenderer.on(desktopChannels.reconnect, reconnect);
window.addEventListener(
  "unload",
  () => {
    commandListeners.clear();
    motionListeners.clear();
    updateListeners.clear();
    ipcRenderer.removeListener(desktopChannels.systemMotion, systemMotion);
    ipcRenderer.removeListener(desktopChannels.updateState, updateState);
    ipcRenderer.removeListener(desktopChannels.commandIntent, commandIntent);
    for (const owner of localeOwners) owner.stream.dispose();
    localeOwners.clear();
    for (const owner of connectionOwners) owner.dispose();
    connectionOwners.clear();
    for (const owner of researchOwners) owner.dispose();
    researchOwners.clear();
    connection.client.dispose();
    ipcRenderer.removeListener(desktopChannels.preferencesReady, preferencesReady);
    ipcRenderer.removeListener(desktopChannels.ended, serviceEnded);
    ipcRenderer.removeListener(desktopChannels.reconnect, reconnect);
  },
  { once: true },
);
