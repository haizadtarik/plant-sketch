import { limitedBody } from "@/lib/computer-use/http";
export const runtime = "nodejs";
export const maxDuration = 20;
type Context = { params: Promise<{ path?: string[] }> };
async function proxy(request: Request, context: Context) {
  const configured = process.env.FUXA_AGENT_URL;
  if (!configured)
    return Response.json(
      {
        error:
          "Computer-use worker is not configured. Set FUXA_AGENT_URL and start npm run fuxa:agent locally.",
      },
      { status: 503 },
    );
  const path = (await context.params).path?.join("/") || "health";
  if (!/^(health|runs(?:\/[\w-]+)?)$/.test(path))
    return Response.json({ error: "Invalid worker route." }, { status: 404 });
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 1024)
    return Response.json(
      { error: "Enter your worker access token." },
      { status: 401 },
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  try {
    const base = new URL(configured);
    if (!["http:", "https:"].includes(base.protocol))
      throw new Error("Invalid worker URL.");
    const response = await fetch(new URL(`/${path}`, base), {
      method: request.method,
      headers: { authorization, "content-type": "application/json" },
      body: request.method === "POST" ? await limitedBody(request) : undefined,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
      cache: "no-store",
      redirect: "error",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "Cannot reach the computer-use worker. Check its URL, token and local process; reconnect before starting another run.",
      },
      { status: 502 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as DELETE };
