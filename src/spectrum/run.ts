// src/spectrum/run.ts
import { runSpectrum } from "./app";

/** `npm run spectrum` → live iMessage line; `npm run spectrum -- --terminal` → offline harness. */
const provider = process.argv.includes("--terminal") ? "terminal" : "imessage";

runSpectrum({ provider }).catch((e) => {
  console.error("[spectrum] fatal:", e);
  process.exit(1);
});
