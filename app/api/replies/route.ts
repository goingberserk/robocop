import { ApiError, Photon } from "@photon-ai/api";
import { findConversation, type Conversation, type ReceivedMessage } from "@/lib/photon";
import {
  parseReply,
  REPLY_LABELS,
  type RepliesResponse,
  type ReplyAction,
  type ReplyCommand,
} from "@/lib/replies";

// This route is public. It only returns commands parsed from the configured
// person's replies, never their text, and only ever sends fixed confirmations.
const MIN_POLL_MS = 2_000;
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MIN_ACK_INTERVAL_MS = 1_000;

let conversation: Conversation | undefined;
let lastAckAt = 0;
let cached: { at: number; since: string; commands: ReplyCommand[] } | undefined;

const config = () => {
  const key = process.env.PHOTON_API_KEY;
  const project = process.env.PHOTON_PROJECT_ID;
  const handle = process.env.PHOTON_ALERT_HANDLE;
  return key && project && handle ? { key, project, handle } : undefined;
};

const logError = (error: unknown) =>
  console.error(
    error instanceof ApiError
      ? `Photon API error ${error.status} (request ${error.requestId ?? "unknown"}).`
      : "Photon request failed.",
  );

export async function GET(request: Request) {
  const empty: RepliesResponse = { commands: [] };
  const settings = config();
  if (!settings) return Response.json(empty, { status: 503 });

  const since = new URL(request.url).searchParams.get("since") ?? "";
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs) || Date.now() - sinceMs > MAX_LOOKBACK_MS) {
    return Response.json(empty, { status: 400 });
  }
  if (cached?.since === since && Date.now() - cached.at < MIN_POLL_MS) {
    return Response.json({ commands: cached.commands } satisfies RepliesResponse);
  }

  const photon = new Photon({
    headers: { Authorization: `Bearer ${settings.key}` },
  });
  try {
    const page = await photon.projects.listMessages({
      path: { id: settings.project },
      query: {
        createdSince: new Date(sinceMs).toISOString(),
        direction: "received",
        order: "asc",
        pageSize: 50,
        platform: "imessage",
      },
    });
    const commands = (page.items as unknown as ReceivedMessage[]).flatMap((m) => {
      if (m.sentBy.kind !== "human" || m.sentBy.handle !== settings.handle) return [];
      if (m.content?.type !== "text" || !m.content.text) return [];
      return parseReply(m.id, m.content.text) ?? [];
    });
    cached = { at: Date.now(), since, commands };
    return Response.json({ commands } satisfies RepliesResponse);
  } catch (error) {
    logError(error);
    return Response.json(empty, { status: 502 });
  }
}

const isValidAck = (
  body: Record<string, unknown>,
): body is { replyId: string; action: ReplyAction; incidents: string[] } =>
  typeof body.replyId === "string" &&
  /^[\w-]{1,80}$/.test(body.replyId) &&
  typeof body.action === "string" &&
  body.action in REPLY_LABELS &&
  Array.isArray(body.incidents) &&
  body.incidents.length <= 50 &&
  body.incidents.every((n) => typeof n === "string" && /^\d{4}$/.test(n));

export async function POST(request: Request) {
  const settings = config();
  if (!settings) return new Response(null, { status: 503 });

  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  if (!isValidAck(body)) return new Response(null, { status: 400 });
  if (Date.now() - lastAckAt < MIN_ACK_INTERVAL_MS) {
    return new Response(null, { status: 429 });
  }
  lastAckAt = Date.now();

  const photon = new Photon({
    headers: { Authorization: `Bearer ${settings.key}` },
  });
  try {
    conversation ??= await findConversation(photon, settings.project, settings.handle);
    if (!conversation) return new Response(null, { status: 409 });
    const label = REPLY_LABELS[body.action].toLowerCase();
    const list = body.incidents.map((n) => `#${n}`).join(", ");
    await photon.projects.sendMessage({
      path: { id: settings.project },
      headers: { "idempotency-key": `reply-ack:${body.replyId}` },
      body: {
        ...conversation,
        content: {
          type: "text",
          format: "plain",
          text: list
            ? `✅ ${list} marked as ${label}.`
            : "I couldn't find an open alert to update.",
        },
      },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    logError(error);
    return new Response(null, { status: 502 });
  }
}
