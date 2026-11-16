import {
  message,
  type InterfaceLocale,
  type ExitChoice,
  type ExitDialogState,
} from "@ohtia/contracts";
import { Dialog } from "./layers.js";
import { Button } from "./controls.js";

export function ExitDialog({
  state,
  locale,
  onChoose,
}: {
  state: ExitDialogState | null;
  locale: InterfaceLocale;
  onChoose: (choice: ExitChoice) => void;
}) {
  const cancelling = state?.phase === "cancelling" && !state.failed;
  return (
    <Dialog
      open={!!state}
      title={message(locale, "exit.title")}
      closeDisabled={cancelling}
      closePlacement="footer"
      footerClassName="command-dialog-footer"
      {...(cancelling ? { closeDisabledReason: message(locale, "exit.cancelling") } : {})}
      closeLabel={message(locale, "dialog.close")}
      onClose={() => {
        if (!cancelling) onChoose("close");
      }}
      className="command-dialog exit-dialog"
      bodyClassName="command-dialog-body"
      footer={
        <>
          <Button
            label={message(locale, "exit.wait")}
            onPress={() => {
              onChoose("wait");
            }}
            {...(cancelling ? { disabledReason: message(locale, "exit.cancelling") } : {})}
          />
          <Button
            label={message(locale, "exit.cancel")}
            onPress={() => {
              onChoose("cancel");
            }}
            {...(cancelling ? { disabledReason: message(locale, "exit.cancelling") } : {})}
          />
        </>
      }
    >
      <p role="status" aria-live="polite" aria-atomic="true">
        {state &&
          message(locale, state.phase === "waiting" ? "exit.waiting" : "exit.body", {
            running: state.running,
          })}
      </p>
      {state?.phase === "waiting" && <p>{message(locale, "exit.queued")}</p>}
      {cancelling && <p role="status">{message(locale, "exit.cancelling")}</p>}
      {state?.failed && <p role="alert">{message(locale, "command.failed")}</p>}
    </Dialog>
  );
}
