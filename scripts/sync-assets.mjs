import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/runtime", { recursive: true });
copyFileSync("lib/simulation.mjs", "public/runtime/simulation.mjs");
copyFileSync(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdf.worker.min.mjs",
);
