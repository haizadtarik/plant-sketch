import type { ComputerAction } from "openai/resources/responses/responses";
import type { Page } from "playwright";
import { setTimeout as delay } from "node:timers/promises";

export function allowedBrowserUrl(url: string, origin: string) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
const aliases: Record<string, string> = {
  CTRL: "Control",
  CONTROL: "Control",
  CMD: "Meta",
  META: "Meta",
  ALT: "Alt",
  SHIFT: "Shift",
  ENTER: "Enter",
  RETURN: "Enter",
  ESC: "Escape",
  ESCAPE: "Escape",
  TAB: "Tab",
  SPACE: "Space",
  BACKSPACE: "Backspace",
  DELETE: "Delete",
  UP: "ArrowUp",
  DOWN: "ArrowDown",
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
  ARROWUP: "ArrowUp",
  ARROWDOWN: "ArrowDown",
  ARROWLEFT: "ArrowLeft",
  ARROWRIGHT: "ArrowRight",
  HOME: "Home",
  END: "End",
  PAGEUP: "PageUp",
  PAGEDOWN: "PageDown",
};
export function browserKey(key: string) {
  if (aliases[key.toUpperCase()]) return aliases[key.toUpperCase()];
  if (/^[a-zA-Z0-9]$/.test(key)) return key.toLowerCase();
  throw new Error(`Unsupported computer key: ${key}`);
}

export async function executeBrowserAction(
  page: Page,
  action: ComputerAction,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const viewport = page.viewportSize()!;
  const point = (p: { x: number; y: number }) => {
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < 0 ||
      p.y < 0 ||
      p.x >= viewport.width ||
      p.y >= viewport.height
    )
      throw new Error("Computer coordinates are outside the viewport.");
  };
  if ("x" in action) point(action);
  const modifiers =
    "keys" in action && action.type !== "keypress"
      ? (action.keys || []).map(browserKey)
      : [];
  try {
    for (const key of modifiers) await page.keyboard.down(key);
    switch (action.type) {
      case "click":
        if (!["left", "right", "wheel"].includes(action.button))
          throw new Error("Unsupported mouse button.");
        await page.mouse.click(action.x, action.y, {
          button:
            action.button === "wheel"
              ? "middle"
              : (action.button as "left" | "right"),
        });
        break;
      case "double_click":
        await page.mouse.dblclick(action.x, action.y);
        break;
      case "move":
        await page.mouse.move(action.x, action.y);
        break;
      case "scroll":
        if (
          ![action.scroll_x, action.scroll_y].every(
            (v) => Number.isFinite(v) && Math.abs(v) <= 10000,
          )
        )
          throw new Error("Invalid scroll distance.");
        await page.mouse.move(action.x, action.y);
        await page.mouse.wheel(action.scroll_x, action.scroll_y);
        break;
      case "type":
        if (typeof action.text !== "string" || action.text.length > 10000)
          throw new Error("Computer text exceeds limit.");
        await page.keyboard.insertText(action.text);
        break;
      case "keypress":
        if (!action.keys?.length || action.keys.length > 5)
          throw new Error("Invalid key combination.");
        await page.keyboard.press(action.keys.map(browserKey).join("+"));
        break;
      case "drag":
        if (!action.path?.length || action.path.length > 200)
          throw new Error("Invalid drag path.");
        action.path.forEach(point);
        await page.mouse.move(action.path[0].x, action.path[0].y);
        await page.mouse.down();
        try {
          for (const p of action.path.slice(1)) {
            signal.throwIfAborted();
            await page.mouse.move(p.x, p.y);
          }
        } finally {
          await page.mouse.up();
        }
        break;
      case "wait":
        await delay(1000, undefined, { signal });
        break;
      case "screenshot":
        break;
      default:
        throw new Error("Unsupported computer action.");
    }
  } finally {
    for (const key of modifiers.reverse())
      await page.keyboard.up(key).catch(() => {});
  }
  await delay(150, undefined, { signal });
}
