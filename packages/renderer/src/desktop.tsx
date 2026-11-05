import { createRoot } from "react-dom/client";
import { ApplicationRoot } from "./application-root.js";
import "./foundation.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root.");
createRoot(root).render(<ApplicationRoot bridge={window.ohtia} />);
