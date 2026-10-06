import { writeFileSync } from "node:fs";
import { sampleModel } from "../lib/fixtures";
import { escapeXml, symbol } from "../lib/symbols";
import { generate } from "../lib/generate";
for (const variant of ["clear", "ambiguous", "alternate"]) {
  const m = sampleModel(variant),
    center = (id: string) => {
      const i = m.items.find((i) => i.id === id)!;
      return {
        x: (i.bbox.x + i.bbox.width / 2) * 1000,
        y: (i.bbox.y + i.bbox.height / 2) * 700,
      };
    };
  const edges = m.connections
    .map((e) => {
      const a = center(e.from),
        b = center(e.to),
        direction = Math.sign(b.x - a.x);
      return `<path d="M${a.x} ${a.y} H${(a.x + b.x) / 2} V${b.y} H${b.x}" stroke="#34404a" stroke-width="${e.type === "process" ? 3 : 1.5}" ${e.type === "measurement" ? 'stroke-dasharray="5 5"' : ""} fill="none"/>${e.type === "process" ? `<path d="M${(a.x + b.x) / 2 - 5 * direction} ${b.y - 4} l${7 * direction} 4 ${-7 * direction} 4" stroke="#34404a" fill="none"/>` : ""}`;
    })
    .join("");
  const nodes = m.items
    .map((i) => {
      const p = center(i.id);
      return `<g transform="translate(${p.x} ${p.y})" stroke="#34404a" stroke-width="1.5" fill="#fff">${symbol(i.kind)}</g><text x="${p.x}" y="${p.y + (i.kind === "tank" ? 90 : 45)}" font-size="16" text-anchor="middle" fill="#34404a">${escapeXml(i.tag)}</text>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700"><rect width="1000" height="700" fill="#fff"/><rect x="25" y="25" width="950" height="650" fill="none" stroke="#d8dfe3"/><text x="50" y="60" font-family="Arial" font-size="19" fill="#34404a">${escapeXml(m.name)} · P&amp;ID sample</text><g font-family="Arial">${edges}${variant === "ambiguous" ? '<path d="M510 340 V530" stroke="#34404a" stroke-width="3"/><text x="470" y="555" fill="#9a6b35" font-size="13">No junction dot: review crossing</text>' : ""}${nodes}</g><text x="50" y="640" font-family="Arial" font-size="13" fill="#657480">ISA-style demo convention · Drawing 001 · Page 1 · Not for engineering use</text></svg>`;
  writeFileSync(`public/fixtures/${variant}.svg`, svg);
  writeFileSync(
    `public/fixtures/${variant}.expected.json`,
    JSON.stringify(m, null, 2),
  );
}
writeFileSync(
  "public/fixtures/reference-project.json",
  JSON.stringify(generate(sampleModel()).project, null, 2),
);
