import { REQUEST_BUDGET, MAX_FILE_SIZE } from "./limits";
export { REQUEST_BUDGET, MAX_FILE_SIZE } from "./limits";
export interface Drawing {
  image: string;
  name: string;
  page: number;
  width: number;
  height: number;
  pages: number;
}
export async function renderFile(file: File, page = 1): Promise<Drawing> {
  if (file.size > MAX_FILE_SIZE)
    throw new Error(
      "File exceeds 20 MB. Export a single page or smaller image.",
    );
  if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type))
    throw new Error("Choose a PDF, PNG or JPEG file.");
  let canvas = document.createElement("canvas"),
    pages = 1;
  if (file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pdf = await task.promise;
    try {
      pages = pdf.numPages;
      if (page < 1 || page > pages)
        throw new Error("Selected page does not exist.");
      const p = await pdf.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(2.5, 2600 / Math.max(base.width, base.height));
      const viewport = p.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await p.render({ canvas, viewport }).promise;
    } finally {
      await task.destroy();
    }
  } else {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 40_000_000) {
      bitmap.close();
      throw new Error("Image exceeds 40 megapixels. Resize before uploading.");
    }
    const ratio = Math.min(1, 2600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  }
  if (canvas.width < 700 || canvas.height < 400)
    throw new Error(
      "Insufficient resolution. Use at least 700 × 400 pixels for readable symbols and tags.",
    );
  let image = "";
  for (const quality of [0.92, 0.85, 0.75]) {
    image = canvas.toDataURL("image/jpeg", quality);
    if (
      new TextEncoder().encode(JSON.stringify({ image, page, name: file.name }))
        .length < REQUEST_BUDGET
    )
      break;
  }
  if (image.length > REQUEST_BUDGET - 2000) {
    const ratio = 0.8;
    const reduced = document.createElement("canvas");
    reduced.width = Math.round(canvas.width * ratio);
    reduced.height = Math.round(canvas.height * ratio);
    const context = reduced.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, reduced.width, reduced.height);
    context.drawImage(canvas, 0, 0, reduced.width, reduced.height);
    canvas = reduced;
    image = canvas.toDataURL("image/jpeg", 0.82);
  }
  if (
    canvas.width < 700 ||
    canvas.height < 400 ||
    new TextEncoder().encode(JSON.stringify({ image, page, name: file.name }))
      .length > REQUEST_BUDGET
  )
    throw new Error(
      "Cannot preserve enough drawing detail within the 3.8 MB request budget. Crop to the process area or export a clearer single page.",
    );
  return {
    image,
    name: file.name,
    page,
    width: canvas.width,
    height: canvas.height,
    pages,
  };
}
