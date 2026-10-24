import { fileURLToPath } from "node:url";
import { generatePortPolicy } from "./port-policy.mjs";

generatePortPolicy(fileURLToPath(new URL("../", import.meta.url)));
