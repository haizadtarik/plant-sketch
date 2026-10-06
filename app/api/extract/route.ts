import { z } from "zod";
import { APIConnectionTimeoutError } from "openai";
import { extract } from "@/lib/extraction";
import { REQUEST_BUDGET } from "@/lib/limits";
export const runtime = "nodejs";
export const maxDuration = 120;
const Input = z.object({
  image: z.string().regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/),
  page: z.number().int().min(1).max(10000),
  name: z.string().min(1).max(200),
});
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > REQUEST_BUDGET)
    return Response.json(
      { error: "Request exceeds the 3.8 MB drawing budget." },
      { status: 413 },
    );
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 90_000);
  const abort = () => controller.abort();
  req.signal.addEventListener("abort", abort);
  try {
    const reader = req.body?.getReader();
    if (!reader)
      return Response.json({ error: "Drawing is missing." }, { status: 400 });
    let size = 0;
    const parts: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REQUEST_BUDGET) {
        await reader.cancel();
        return Response.json(
          {
            error:
              "Request exceeds 3.8 MB including encoding. Crop or resize the drawing.",
          },
          { status: 413 },
        );
      }
      parts.push(value);
    }
    const parsed = Input.safeParse(
      JSON.parse(Buffer.concat(parts).toString("utf8")),
    );
    if (!parsed.success)
      return Response.json(
        { error: "Invalid image request. Re-upload the selected page." },
        { status: 400 },
      );
    const model = await extract(
      parsed.data.image,
      parsed.data.page,
      parsed.data.name,
      controller.signal,
    );
    return Response.json({ model });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (controller.signal.aborted || e instanceof APIConnectionTimeoutError)
      return Response.json(
        {
          error:
            "Extraction cancelled or timed out. Try a clearer single-page crop.",
        },
        { status: 504 },
      );
    if (status === 429)
      return Response.json(
        { error: "AI provider rate limit reached. Wait before retrying." },
        { status: 429 },
      );
    if (status === 401 || status === 403)
      return Response.json(
        {
          error:
            "AI provider credentials are invalid or lack model access. Ask the operator to check server configuration.",
        },
        { status: 502 },
      );
    if (status === 400 || status === 404)
      return Response.json(
        {
          error:
            "The provider rejected the configured model or image request. Verify image-input and structured-output support, then retry.",
        },
        { status: 502 },
      );
    if (e instanceof SyntaxError)
      return Response.json(
        { error: "Malformed request JSON." },
        { status: 400 },
      );
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Extraction failed. Please retry.",
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
    req.signal.removeEventListener("abort", abort);
  }
}
