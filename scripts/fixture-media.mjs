import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
const path =
  homedir() +
  "/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const browser = await chromium.launch({ executablePath: path });
const page = await browser.newPage({
  viewport: { width: 1000, height: 700 },
  deviceScaleFactor: 1,
});
for (const id of ["clear", "ambiguous", "alternate"]) {
  const svg = readFileSync("public/fixtures/" + id + ".svg", "utf8");
  await page.setContent("<style>body{margin:0}</style>" + svg);
  await page.screenshot({ path: "public/fixtures/" + id + ".png" });
  await page.screenshot({
    path: "public/fixtures/" + id + ".jpg",
    type: "jpeg",
    quality: 95,
  });
  await page.pdf({
    path: "public/fixtures/" + id + ".pdf",
    width: "1000px",
    height: "700px",
    printBackground: true,
  });
}
await page.setContent(
  "<style>body{margin:0}.sheet{break-after:page;width:1000px;height:700px}</style>" +
    ["clear", "ambiguous"]
      .map(
        (id) =>
          '<div class="sheet">' +
          readFileSync("public/fixtures/" + id + ".svg", "utf8") +
          "</div>",
      )
      .join(""),
);
await page.pdf({
  path: "public/fixtures/two-pages.pdf",
  width: "1000px",
  height: "700px",
  printBackground: true,
});
await browser.close();
