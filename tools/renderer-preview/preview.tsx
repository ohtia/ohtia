import { CommandSpecimens } from "./command-specimens.js";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionMenu,
  Button,
  Choice,
  Confirmation,
  DataTable,
  Dialog,
  ErrorSummary,
  Form,
  IconButton,
  Link,
  LucideGlyph,
  Notice,
  OperationStatus,
  Panel,
  Popover,
  Progress,
  Selector,
  Separator,
  Skeleton,
  StateLabel,
  Tabs,
  TextField,
  ToastRegion,
  Tooltip,
  useFieldDraft,
  type PresentationEvent,
  type PresentationPhase,
} from "@ohtia/renderer";
import "../../packages/renderer/src/foundation.css";

function Preview() {
  const [appearance, setAppearance] = useState("system");
  const [expanded, setExpanded] = useState(false);
  const [korean, setKorean] = useState(false);
  const text = (value: string) => {
    const localized = korean ? `${value} — 연구 근거 확인` : value;
    return expanded
      ? `${localized} ${"x".repeat(Math.ceil(Array.from(localized).length * 0.4))}`
      : localized;
  };
  const draft = useFieldDraft("Researcher draft 연구 초안");
  const [checked, setChecked] = useState(false);
  const [radio, setRadio] = useState("first");
  const [tab, setTab] = useState("one");
  const [notes, setNotes] = useState(true);
  const [closeNotes, setCloseNotes] = useState(false);
  const [switchFromNotes, setSwitchFromNotes] = useState(false);
  const selectedTab = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [holdDialog, setHoldDialog] = useState(false);
  const [showDialogField, setShowDialogField] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [submission, setSubmission] = useState(0);
  const [event, setEvent] = useState<PresentationEvent>();
  const [toast, setToast] = useState<{ id: string; label: string }>();
  const [sort, setSort] = useState<"ascending" | "descending">("ascending");
  const action = () => {
    setToast({ id: crypto.randomUUID(), label: text("Synthetic action accepted") });
  };
  const validate = (value: string) => {
    setError(value.trim() ? "" : text("Enter a title. Your draft is retained."));
  };
  return (
    <main lang={korean ? "ko-KR" : "en-GB"}>
      <CommandSpecimens />
      <h1>Ohtia semantic catalog</h1>
      <p>
        Synthetic controls and callbacks. Changes are not saved. These specimens do not confirm
        research, storage or provider effects.
      </p>
      <Panel label="Catalog display">
        <Selector
          id="catalog-theme"
          label="Theme"
          value={appearance}
          options={["system", "light", "dark"].map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setAppearance(value);
            document.documentElement.dataset.appearance = value;
          }}
        />
        <Choice
          id="catalog-expand"
          kind="checkbox"
          label="Expand labels by at least 40%"
          checked={expanded}
          onChange={setExpanded}
        />
        <Choice
          id="catalog-korean"
          kind="switch"
          label="Korean mixed-script specimens"
          checked={korean}
          onChange={setKorean}
        />
      </Panel>
      <Panel label={text("Actions")}>
        <div className="actions">
          {(["primary", "secondary", "quiet", "destructive"] as const).map((variant) => (
            <Button
              key={variant}
              label={text(`${variant} action`)}
              variant={variant}
              onPress={action}
            />
          ))}
          <Button label={text("Save draft")} loadingLabel={text("Saving draft")} onPress={action} />
          <Button
            label={text("Unavailable action")}
            disabledReason={text("Select a source first")}
            onPress={action}
          />
          <IconButton
            label={text("Add source")}
            icon={<LucideGlyph name="plus" />}
            onPress={action}
          />
        </div>
        <p>
          <Link href="https://ohtia.org" externalLabel={text("external website")}>
            {text("Ohtia website")}
          </Link>
        </p>
      </Panel>
      <Panel label={text("Fields")}>
        <Form
          onSubmit={() => {
            validate(draft.value);
            setSubmission((value) => value + 1);
          }}
        >
          <TextField
            id="catalog-title"
            label={text("Source title")}
            help={text("Keep your own wording")}
            value={draft.value}
            onChange={draft.edit}
            onValidate={validate}
            error={error}
          />
          <Selector
            id="catalog-selector"
            label={text("Source type")}
            value={radio}
            options={[
              { value: "first", label: text("Article") },
              { value: "second", label: text("Book") },
            ]}
            onChange={setRadio}
          />
          <Choice
            id="catalog-check"
            kind="checkbox"
            label={text("Include archived items")}
            checked={checked}
            onChange={setChecked}
          />
          {["first", "second"].map((value) => (
            <Choice
              key={value}
              id={`catalog-radio-${value}`}
              name="source-format"
              kind="radio"
              label={text(value)}
              checked={radio === value}
              onChange={() => setRadio(value)}
            />
          ))}
          <button type="submit">{text("Validate title")}</button>
          <ErrorSummary
            title={text("Correct the title")}
            errors={error ? [{ fieldId: "catalog-title", message: error }] : []}
            submission={submission}
          />
        </Form>
      </Panel>
      <Panel label={text("Tabs")}>
        <Tabs
          label={text("Research views")}
          selected={tab}
          onSelect={setTab}
          selectedTabRef={selectedTab}
          onClose={() => setCloseNotes(true)}
          items={[
            { id: "one", label: text("Source"), content: <p>{text("Source content")}</p> },
            ...(notes
              ? [
                  {
                    id: "two",
                    label: text("Notes"),
                    content: (
                      <>
                        <p>{text("Notes content")}</p>
                        <Button
                          label={text("Switch from notes")}
                          onPress={() => setSwitchFromNotes(true)}
                        />
                      </>
                    ),
                    closeLabel: text("Close notes"),
                  },
                ]
              : []),
          ]}
        />
      </Panel>
      <Panel label={text("Layers")}>
        <ActionMenu
          label={text("Source actions")}
          actions={[
            { id: "rename", label: text("Rename source"), onPress: action },
            {
              id: "remove",
              label: text("Remove source"),
              disabledReason: text("Source is in use"),
              onPress: action,
            },
          ]}
        />
        <ActionMenu
          contextual
          label={text("Context actions")}
          actions={[{ id: "copy", label: text("Copy reference"), onPress: action }]}
        >
          <p>{text("Right-click here or use the context actions button.")}</p>
        </ActionMenu>
        <Tooltip label={text("Additional, optional explanation")}>
          <button type="button">{text("Help for sources")}</button>
        </Tooltip>
        <Popover label={text("Source details")} closeLabel={text("Close details")}>
          <p>{text("Inspectable supplementary details")}</p>
        </Popover>
        <Button label={text("Open dialog")} onPress={() => setOpen(true)} />
        <Button label={text("Delete synthetic source")} onPress={() => setConfirm(true)} />
      </Panel>
      <Dialog
        open={open}
        title={text("Source dialog")}
        closeLabel={text("Close dialog")}
        onClose={() => {
          if (!holdDialog) setOpen(false);
        }}
      >
        {showDialogField && (
          <TextField
            id="dialog-title"
            label={text("Dialog title")}
            value={draft.value}
            onChange={draft.edit}
            onValidate={validate}
          />
        )}
        <Tooltip label={text("Optional dialog help")}>
          <button type="button">{text("Dialog help")}</button>
        </Tooltip>
        <Popover label={text("Dialog details")} closeLabel={text("Close dialog details")}>
          <p>{text("Supplementary dialog details")}</p>
        </Popover>
        <Button label={text("Attempt second modal")} onPress={() => setConfirm(true)} />
        <Button label={text("Remove focused field")} onPress={() => setShowDialogField(false)} />
        <Choice
          id="hold-dialog"
          kind="checkbox"
          label={text("Ignore close requests")}
          checked={holdDialog}
          onChange={setHoldDialog}
        />
      </Dialog>
      <Confirmation
        open={switchFromNotes}
        title={text("Switch to source?")}
        consequences={<p>{text("Notes stay mounted in their hidden panel.")}</p>}
        cancelLabel={text("Stay in notes")}
        confirmLabel={text("Switch to source")}
        returnFocusRef={selectedTab}
        onCancel={() => setSwitchFromNotes(false)}
        onConfirm={() => {
          setTab("one");
          setSwitchFromNotes(false);
        }}
      />
      <Confirmation
        open={closeNotes}
        title={text("Close notes tab?")}
        consequences={<p>{text("Only the synthetic notes tab will close.")}</p>}
        cancelLabel={text("Keep notes open")}
        confirmLabel={text("Close notes tab")}
        returnFocusRef={selectedTab}
        onCancel={() => setCloseNotes(false)}
        onConfirm={() => {
          setNotes(false);
          setTab("one");
          setCloseNotes(false);
        }}
      />
      <Confirmation
        open={confirm}
        title={text("Delete synthetic source?")}
        consequences={
          <p>{text("Only this synthetic item would be removed. No research is affected.")}</p>
        }
        cancelLabel={text("Keep source")}
        confirmLabel={text("Confirm deletion")}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          action();
        }}
      />
      <Panel label={text("States and notices")}>
        {(
          [
            "requested",
            "accepted",
            "uncertain",
            "failed",
            "confirmed",
            "pending",
            "rejected",
            "review-required",
          ] as PresentationPhase[]
        ).map((phase) => (
          <p key={phase}>
            <StateLabel phase={phase} label={text(phase)} />
          </p>
        ))}
        <Notice
          title={text("Title could not be saved")}
          tone="danger"
          action={{ label: text("Try again"), onPress: action }}
        >
          <p>{text("Your input is retained. Retry when storage is available.")}</p>
        </Notice>
        <Notice title={text("Review this source")}>
          <p>{text("Coverage is incomplete.")}</p>
        </Notice>
        <Button
          label={text("Accept synthetic operation")}
          onPress={() =>
            setEvent({
              operationId: "catalog-operation",
              revision: (event?.revision ?? 0) + 1,
              phase: "accepted",
              source: "response",
              label: text("Synthetic request accepted"),
            })
          }
        />
        <OperationStatus operationId="catalog-operation" {...(event ? { event } : {})} />
      </Panel>
      <Panel label={text("Table and compact list")}>
        {[false, true].map((compact) => (
          <DataTable
            key={String(compact)}
            compact={compact}
            label={text("Sources")}
            columns={[{ id: "count", label: text("Pages"), numeric: true }]}
            rows={[
              { id: "source-1", heading: text("Synthetic source 연구"), cells: { count: "120" } },
            ]}
            sort={{ column: "count", direction: sort, label: text(`Pages: ${sort}`) }}
            onSort={() => setSort((value) => (value === "ascending" ? "descending" : "ascending"))}
            more={{ label: text("Load next batch"), onPress: action }}
          />
        ))}
      </Panel>
      <Separator />
      <Panel label={text("Loading")}>
        <Skeleton label={text("Loading source details")} />
        <Progress
          label={text("Import sources")}
          phase={text("Reading metadata")}
          value={2}
          max={5}
        />
        <Progress label={text("Inspect source")} phase={text("Waiting for metadata")} />
      </Panel>
      <ToastRegion
        {...(toast ? { toast } : {})}
        dismissLabel={text("Dismiss notification")}
        onDismiss={() => setToast(undefined)}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Catalog root is missing.");
createRoot(root).render(<Preview />);
