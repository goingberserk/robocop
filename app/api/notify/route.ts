import { ApiError, Photon } from "@photon-ai/api";
import { OTHER_CATEGORIES, STREET_CATEGORIES } from "@/lib/detection";
import type { NotifyRequest, NotifyResponse } from "@/lib/notify";

// This route is public and its key is not, so it only ever sends one fixed kind
// of text to one configured person, at a limited rate.
const MIN_INTERVAL_MS = 30_000;

const CATEGORIES = new Set([...STREET_CATEGORIES, ...OTHER_CATEGORIES]);

type Conversation = { spaceId: string; senderId: string };

// The client types these fields as unknown; this is their documented shape.
type ReceivedMessage = {
  sentBy: { kind: string; handle?: string };
  receivedBy?: { kind: string; id: string };
  space: { kind: string; id: string };
};

let conversation: Conversation | undefined;
let lastSentAt = 0;

const reply = (body: NotifyResponse, status: number) =>
  Response.json(body, { status });

const isValid = (body: Partial<NotifyRequest>): body is NotifyRequest =>
  typeof body.id === "string" &&
  /^[0-9a-f-]{36}$/.test(body.id) &&
  typeof body.category === "string" &&
  CATEGORIES.has(body.category) &&
  Number.isInteger(body.count) &&
  body.count! > 0 &&
  body.count! < 1000 &&
  typeof body.time === "number" &&
  body.time >= 0;

// A shared line cannot send the first message, so the conversation comes from
// the last text the configured person sent to it.
async function findConversation(
  photon: Photon,
  project: string,
  handle: string,
): Promise<Conversation | undefined> {
  const page = await photon.projects.listMessages({
    path: { id: project },
    query: {
      direction: "received",
      order: "desc",
      pageSize: 100,
      platform: "imessage",
    },
  });
  const message = (page.items as unknown as ReceivedMessage[]).find(
    (m) =>
      m.sentBy.kind === "human" &&
      m.sentBy.handle === handle &&
      m.receivedBy?.kind === "agent" &&
      m.space.kind === "direct",
  );
  return (
    message?.receivedBy && {
      spaceId: message.space.id,
      senderId: message.receivedBy.id,
    }
  );
}

export async function POST(request: Request) {
  const key = process.env.PHOTON_API_KEY;
  const project = process.env.PHOTON_PROJECT_ID;
  const handle = process.env.PHOTON_ALERT_HANDLE;
  if (!key || !project || !handle) {
    return reply({ status: "not_configured" }, 503);
  }

  const body: Partial<NotifyRequest> = await request.json().catch(() => ({}));
  if (!isValid(body)) return reply({ status: "invalid" }, 400);

  const now = Date.now();
  if (now - lastSentAt < MIN_INTERVAL_MS) {
    return reply({ status: "rate_limited" }, 429);
  }
  lastSentAt = now;

  const photon = new Photon({ headers: { Authorization: `Bearer ${key}` } });
  try {
    conversation ??= await findConversation(photon, project, handle);
    if (!conversation) {
      lastSentAt = 0;
      return reply({ status: "no_conversation" }, 409);
    }
    const minutes = Math.floor(body.time / 60);
    const seconds = String(Math.floor(body.time % 60)).padStart(2, "0");
    await photon.projects.sendMessage({
      path: { id: project },
      headers: { "idempotency-key": `zone-event:${body.id}` },
      body: {
        ...conversation,
        content: {
          type: "text",
          format: "plain",
          text: `robocop: ${body.category} entered the zone (${body.count} in zone) at ${minutes}:${seconds} in the video.`,
        },
      },
    });
    return reply({ status: "sent" }, 200);
  } catch (error) {
    lastSentAt = 0;
    console.error(
      error instanceof ApiError
        ? `Photon API error ${error.status} (request ${error.requestId ?? "unknown"}).`
        : "Photon request failed.",
    );
    return reply({ status: "failed" }, 502);
  }
}
