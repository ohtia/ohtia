import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppearanceControl } from "@ohtia/renderer";

function Preview() {
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">("system");
  return (
    <main>
      <h1>Appearance preview</h1>
      <p>Changes are not saved.</p>
      <AppearanceControl
        value={appearance}
        label="Appearance"
        labels={{ system: "System", light: "Light", dark: "Dark" }}
        onChange={setAppearance}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Preview root is missing.");
createRoot(root).render(<Preview />);
