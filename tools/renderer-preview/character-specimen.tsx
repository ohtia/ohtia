import { useEffect, useState, useSyncExternalStore } from "react";
import {
  message,
  supportedLocales,
  type InterfaceLocale,
  type CharacterPresentation,
} from "../../packages/contracts/dist/index.js";
import {
  Choice,
  CharacterController,
  CharacterDecoration,
  CharacterDrawing,
  ContributorAttribution,
  VoiceLabel,
  contributorNames,
  type ContributorId,
  type CharacterPose,
  type CharacterEvent,
} from "@ohtia/renderer";

/** Development-only inputs. No port, contributor selection, model discovery or research event route. */
export function CharacterSpecimen() {
  const [mode, setMode] = useState<CharacterPresentation>("animated");
  const [locale, setLocale] = useState<InterfaceLocale>("en-US");
  const [manuscript, setManuscript] = useState(false);
  const [buffer, setBuffer] = useState("Researcher text stays intact. 연구자의 글을 보존합니다.");
  const [pose, setPose] = useState<CharacterPose>("thinking");
  const [lifetime, setLifetime] = useState(0);
  const [navigatorOpening, setNavigatorOpening] = useState(0);
  const [sequence, setSequence] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [last, setLast] = useState<CharacterEvent>();
  const [controller, setController] = useState(
    () => new CharacterController("synthetic-project", "static"),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(
    () => () => {
      controller.dispose();
    },
    [controller],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    if (navigatorOpening) controller.openNavigator(true, true);
  }, [controller, navigatorOpening]);
  const deliver = (newBatch: boolean) => {
    const next = sequence + 1;
    setSequence(next);
    const event: CharacterEvent = {
      id: `synthetic-${next}`,
      project: "synthetic-project",
      action: "catalog-button",
      result: `synthetic-result-${next}`,
      producer: undefined,
      batch: newBatch ? `batch-${next}` : (last?.batch ?? "batch-0"),
      text: "Synthetic notice: no research result or approval. Coverage and producer remain unknown.",
      language: "en-US",
      pose,
      relevant: true,
      deferToNavigator: true,
    };
    setLast(event);
    controller.receive(event);
  };
  return (
    <main className="character-catalog" lang="en-US">
      <h1>Character and contributor catalog</h1>
      <p>
        Synthetic controls. Nothing is saved. These inputs do not represent application events,
        research findings, provider readiness or human review.
      </p>
      <div className="actions">
        <label>
          Presentation{" "}
          <select
            aria-label="Presentation"
            value={mode}
            onChange={(e) => {
              setMode(e.currentTarget.value as CharacterPresentation);
            }}
          >
            {(["animated", "static", "hidden"] as const).map((value) => (
              <option key={value} value={value}>
                {message(locale, `settings.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Interface language{" "}
          <select
            aria-label="Interface language"
            value={locale}
            onChange={(e) => {
              setLocale(e.currentTarget.value as InterfaceLocale);
            }}
          >
            {supportedLocales.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Synthetic pose{" "}
          <select
            aria-label="Synthetic pose"
            value={pose}
            onChange={(e) => {
              setPose(e.currentTarget.value as CharacterPose);
            }}
          >
            {(["thinking", "disagreement", "milestone"] as const).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <Choice
          id="character-expand"
          kind="checkbox"
          label="Expand specimen labels by 40%"
          checked={expanded}
          onChange={setExpanded}
        />
        <Choice
          id="character-manuscript"
          kind="checkbox"
          label="Synthetic manuscript visible"
          checked={manuscript}
          onChange={setManuscript}
        />
      </div>
      <section aria-label="Synthetic event controls">
        <h2>Synthetic event presentation</h2>
        <div className="actions">
          <button
            onClick={() => {
              deliver(true);
            }}
          >
            New synthetic batch
          </button>
          <button
            onClick={() => {
              deliver(false);
            }}
          >
            Same batch, new event
          </button>
          <button
            onClick={() => {
              if (last) controller.receive(last);
            }}
          >
            Duplicate event
          </button>
          <button
            onClick={() => {
              setManuscript(false);
              setNavigatorOpening((value) => value + 1);
            }}
          >
            Explicit Navigator opening
          </button>
          <button
            onClick={() => {
              setManuscript(false);
              if (last) controller.receive(last, true);
              controller.openNavigator(false, true);
            }}
          >
            Passive restoration
          </button>
          <button
            onClick={() => {
              controller.invalidate();
            }}
          >
            Dismiss or resolve
          </button>
          <button
            onClick={() => {
              controller.dispose();
              const restarted = new CharacterController("synthetic-project", "static");
              if (last) restarted.restore(last);
              setNavigatorOpening(0);
              setMode("static");
              setController(restarted);
            }}
          >
            Restart static preview
          </button>
          <button
            onClick={() => {
              setLifetime((value) => value + 1);
            }}
          >
            Replace renderer
          </button>
        </div>
        <CharacterDecoration
          key={lifetime}
          controller={controller}
          confirmed={mode}
          manuscriptVisible={manuscript}
        />
        <p data-character-state>
          {state.mode}: {state.playing ? "playing" : state.deferred ? "deferred" : "still"}
        </p>
        {state.notice && (
          <p lang={state.notice.language} dir="auto">
            {state.notice.text}
          </p>
        )}
        {manuscript && (
          <label>
            Synthetic manuscript buffer
            <textarea
              aria-label="Synthetic manuscript buffer"
              value={buffer}
              onChange={(event) => {
                setBuffer(event.currentTarget.value);
              }}
            />
          </label>
        )}
      </section>
      <section>
        <h2>Static identities and preserved attribution</h2>
        <p>
          Symbols and names remain visible in Hidden mode. All examples below are synthetic.
          Original supervisor feedback and AI interpretation have separate attribution.
        </p>
        <VoiceLabel identity={{ kind: "product" }} locale={locale} />
        <div className="character-identities">
          {(Object.keys(contributorNames) as ContributorId[]).map((contributor) => (
            <article key={contributor}>
              <h3>{contributorNames[contributor]}</h3>
              <ContributorAttribution
                identity={{ kind: "ai", contributor, definitionVersion: "synthetic-definition-1" }}
                locale={locale}
                producer={undefined}
                execution={
                  expanded
                    ? message(locale, "identity.unknown") + " " + "x".repeat(80)
                    : message(locale, "identity.unknown")
                }
              />
              <p lang="en-US">
                Synthetic retained contribution. No source examination or approval is implied.
              </p>
            </article>
          ))}
          <article>
            <h3>Synthetic original human feedback</h3>
            <ContributorAttribution
              identity={{
                kind: "supervisor",
                author: "Declared synthetic author",
                submittedVersion: "synthetic-revision-3",
              }}
              locale={locale}
              producer="synthetic-import-declaration"
              execution={message(locale, "identity.unknown")}
            />
          </article>
          <article>
            <h3>Synthetic unknown origin</h3>
            <ContributorAttribution
              identity={{ kind: "unknown" }}
              locale={locale}
              producer={undefined}
              execution={message(locale, "identity.unknown")}
            />
          </article>
        </div>
      </section>
      {!manuscript && mode !== "hidden" && (
        <section>
          <h2>Frozen geometry and main poses</h2>
          <div className="actions">
            {([undefined, "thinking", "disagreement", "milestone"] as const).map((value, index) => (
              <figure key={index}>
                <CharacterDrawing pose={value} size={96} />
                <figcaption>{value ?? "neutral"} — 96 px, static</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
