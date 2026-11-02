import { appearances, isAppearance, type Appearance } from "@ohtia/contracts";

export interface AppearanceControlProps {
  value: Appearance;
  label: string;
  labels: Readonly<Record<Appearance, string>>;
  onChange: (appearance: Appearance) => void;
  disabled?: boolean;
}

export function AppearanceControl({
  value,
  label,
  labels,
  onChange,
  disabled,
}: AppearanceControlProps) {
  return (
    <label>
      {label}
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isAppearance(next)) onChange(next);
        }}
      >
        {appearances.map((appearance) => (
          <option key={appearance} value={appearance}>
            {labels[appearance]}
          </option>
        ))}
      </select>
    </label>
  );
}

export { designMetrics, iconMappings } from "./design-tokens.js";
export { OhtiaBrand, OhtiaGlasses } from "./branding.js";
export { LucideGlyph, type LucideName } from "./iconography.js";
export * from "./workspace-geometry.js";
export * from "./workspace-controller.js";
export * from "./layout-preferences.js";
export {
  Button,
  Link,
  TextField,
  Selector,
  Choice,
  ErrorSummary,
  Form,
  useFieldDraft,
  type ButtonProps,
  type TextFieldProps,
} from "./controls.js";
export { Tabs, type TabItem } from "./tabs.js";
export {
  Dialog,
  Confirmation,
  Tooltip,
  IconButton,
  Popover,
  ActionMenu,
  type MenuAction,
} from "./layers.js";
export {
  StateLabel,
  OperationStatus,
  Notice,
  ToastRegion,
  DataTable,
  Skeleton,
  Progress,
  Panel,
  Separator,
  type PresentationPhase,
  type PresentationEvent,
  type ToastMessage,
  type TableColumn,
  type TableRow,
} from "./presentation.js";

export * from "./command-controller.js";

export * from "./command-surfaces.js";
