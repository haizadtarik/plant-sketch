import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { bundle } from "../lib/export";
import { sampleModel } from "../lib/fixtures";
const zip = await bundle(
  sampleModel(),
  readFileSync("lib/simulation.mjs", "utf8"),
);
writeFileSync(
  "public/fixtures/sample-runtime.zip",
  await zip.generateAsync({ type: "nodebuffer" }),
);
const dir = "/tmp/pnid-runtime-check";
mkdirSync(dir, { recursive: true });
for (const [name, file] of Object.entries(zip.files)) {
  if (file.dir) continue;
  const path = dir + "/" + name;
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, await file.async("nodebuffer"));
}
console.log("Sample runtime bundle generated.");
