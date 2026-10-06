import type { Item } from "./model";
export const escapeXml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Fixed vector templates, editable as native SVG shapes in FUXA. */
export function symbol(kind: Item["kind"]): string {
  switch (kind) {
    case "tank":
      return '<rect x="-45" y="-65" width="90" height="130" rx="12"/><ellipse cx="0" cy="-52" rx="44" ry="12" fill="none"/><path d="M-45 50 Q0 75 45 50" fill="none"/>';
    case "pump":
      return '<circle r="28"/><path d="M-14 -17 L19 0 L-14 17 Z" fill="none"/><path d="M-30 28 H30"/>';
    case "control-valve":
      return '<path d="M-28 -20 L28 20 L28 -20 L-28 20 Z"/><path d="M0 0 V-36 M-15 -36 H15" fill="none"/>';
    case "level":
    case "flow":
      return `<circle r="25"/><text y="5" text-anchor="middle" fill="#26323b" stroke="none" font-size="13">${kind === "level" ? "LT" : "FT"}</text>`;
    default:
      return '<rect x="-25" y="-25" width="50" height="50"/><text text-anchor="middle" y="5">?</text>';
  }
}
