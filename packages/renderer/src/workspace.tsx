import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CommandBridge, FoundationPort } from "@ohtia/contracts";
import { CommandSurfaces } from "./command-surfaces.js";
import { LayoutPreferences } from "./layout-preferences.js";
import { WorkspaceChrome, type WorkspaceChromeProps } from "./workspace-chrome.js";

export interface WorkspaceProps extends Omit<
  WorkspaceChromeProps,
  "preferences" | "commands" | "layoutFailure" | "onDismissLayoutFailure" | "fallbackFocusRef"
> {
  readonly port: FoundationPort;
  readonly commandBridge: CommandBridge;
  readonly registerHandlers?: Parameters<typeof CommandSurfaces>[0]["registerHandlers"];
}
/** Mount once per admitted workspace window. Accepted layout writes outlive the mounted controller. */
export function Workspace({
  port,
  commandBridge,
  registerHandlers,
  ...presentation
}: WorkspaceProps) {
  useLayoutEffect(() => {
    document.documentElement.lang = presentation.locale;
  }, [presentation.locale]);
  const returnFocusRef = useRef<HTMLAnchorElement | null>(null);
  const [failure, setFailure] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const preferences = useMemo(
    () =>
      new LayoutPreferences(
        port,
        () => crypto.randomUUID(),
        () => {
          if (live.current) setFailure(true);
        },
      ),
    [port],
  );
  return (
    <div className="workspace-window">
      <CommandSurfaces
        bridge={commandBridge}
        returnFocusRef={returnFocusRef}
        locale={presentation.locale}
        {...(presentation.decoration ? { decoration: presentation.decoration } : {})}
        {...(registerHandlers ? { registerHandlers } : {})}
      >
        {(commands) =>
          commands && (
            <WorkspaceChrome
              {...presentation}
              fallbackFocusRef={returnFocusRef}
              preferences={preferences}
              commands={commands}
              layoutFailure={failure}
              onDismissLayoutFailure={() => {
                setFailure(false);
              }}
            />
          )
        }
      </CommandSurfaces>
    </div>
  );
}
