import { appearances, isAppearance, type Appearance } from "@ohtia/contracts";

export interface AppearanceControlProps {
  value: Appearance;
  label: string;
  labels: Readonly<Record<Appearance, string>>;
  onChange: (appearance: Appearance) => void;
}

export function AppearanceControl({ value, label, labels, onChange }: AppearanceControlProps) {
  return (
    <label>
      {label}
      <select
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
