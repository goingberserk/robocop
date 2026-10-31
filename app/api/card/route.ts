import { renderIncidentCard } from "@/lib/card/render";
import type { IncidentInput } from "@/lib/incident";
import { sentenceFor } from "@/lib/sentence";

// Preview endpoint: POST an IncidentInput, get the card PNG back. The notify
// route renders the same card; this exists to look at it.
const MAX_FRAME_CHARS = 2_000_000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as IncidentInput | null;
  if (!body || typeof body.frame !== "string" || body.frame.length > MAX_FRAME_CHARS) {
    return new Response("Bad request", { status: 400 });
  }
  const input: IncidentInput = { ...body, sentence: body.sentence ?? sentenceFor(body) };
  const png = await renderIncidentCard(input);
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
