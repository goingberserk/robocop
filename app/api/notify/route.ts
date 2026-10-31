import { ApiError, Photon } from "@photon-ai/api";
import { OTHER_CATEGORIES, STREET_CATEGORIES } from "@/lib/detection";
import type { NotifyRequest, NotifyResponse } from "@/lib/notify";
import { streams } from "@/lib/streams";

// This route is public and its key is not, so it only ever sends one fixed kind
// of text to one configured person, at a limited rate.
const MIN_INTERVAL_MS = 5_000;
const MAX_IMAGE_BYTES = 1_000_000;

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

const isSmallInteger = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < 100_000;

const hasValidKind = (body: Record<string, unknown>) => {
  if (body.kind === "luggage") return isSmallInteger(body.alone);
  if (!isSmallInteger(body.count) || body.count === 0) return false;
  return body.kind === "crowd" ? isSmallInteger(body.limit) : body.kind === "zone";
};

const PLURALS: Record<string, string> = {
  person: "people",
  bus: "buses",
  skis: "skis",
};

const plural = (category: string) => PLURALS[category] ?? `${category}s`;

const withArticle = (category: string) =>
  `${/^[aeiou]/.test(category) ? "An" : "A"} ${category}`;

const alertLines = (body: NotifyRequest): [string, string] => {
  switch (body.kind) {
    case "luggage":
      return [
        "🧳 Left luggage",
        `${withArticle(body.category)} has been left unattended for ${body.alone} seconds.`,
      ];
    case "crowd":
      return [
        "👥 Crowded space",
        `${body.count} people are in your area. The limit is ${body.limit}.`,
      ];
    case "zone":
      return [
        "🚨 Trespassing",
        body.count === 1
          ? `${withArticle(body.category)} entered your restricted area.`
          : `${body.count} ${plural(body.category)} are in your restricted area.`,
      ];
  }
};

const alertText = (body: NotifyRequest) => {
  const [title, detail] = alertLines(body);
  const stream = streams.find((s) => s.id === body.source)!;
  const minutes = Math.floor(body.time / 60);
  const seconds = String(Math.floor(body.time % 60)).padStart(2, "0");
  // A camera has no position in a recording to point at.
  const source = stream.clipUrl
    ? `${stream.label}, at ${minutes}:${seconds}`
    : stream.label;
  return `${title}\n${detail}\n\nSource: ${source}`;
};

const isValid = (body: Record<string, unknown>): body is NotifyRequest =>
  hasValidKind(body) &&
  typeof body.id === "string" &&
  /^[0-9a-f-]{36}$/.test(body.id) &&
  streams.some((s) => s.id === body.source) &&
  typeof body.category === "string" &&
  CATEGORIES.has(body.category) &&
  typeof body.time === "number" &&
  body.time >= 0 &&
  (body.image === undefined || typeof body.image === "string");

// Only accept what the client is meant to send: a small JPEG.
function decodeJpeg(image: string): Uint8Array<ArrayBuffer> | undefined {
  const bytes = new Uint8Array(Buffer.from(image, "base64"));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isJpeg && bytes.length <= MAX_IMAGE_BYTES ? bytes : undefined;
}

async function sendImage(
  photon: Photon,
  project: string,
  target: Conversation,
  id: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const boundary = crypto.randomUUID();
  const metadata = JSON.stringify({
    contentType: "image/jpeg",
    sizeBytes: bytes.length,
    filename: "detection.jpg",
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--\r\n`,
  ]);
  const attachment = await photon.projects.uploadAttachment({
    path: { id: project },
    headers: {
      "content-length": String(body.size),
      "content-type": `multipart/related; boundary=${boundary}`,
      "idempotency-key": `zone-event-image:${id}`,
    },
    body,
  });
  await photon.projects.sendMessage({
    path: { id: project },
    headers: { "idempotency-key": `zone-event-photo:${id}` },
    body: {
      ...target,
      content: { type: "attachment", attachmentId: attachment.id },
    },
  });
}

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

  const body: Record<string, unknown> = await request.json().catch(() => ({}));
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
    await photon.projects.sendMessage({
      path: { id: project },
      headers: { "idempotency-key": `zone-event:${body.id}` },
      body: {
        ...conversation,
        content: {
          type: "text",
          format: "plain",
          text: alertText(body),
        },
      },
    });
    if (!body.image) return reply({ status: "sent_without_image" }, 200);
    try {
      const bytes = decodeJpeg(body.image);
      if (!bytes) throw new Error("Invalid image.");
      await sendImage(photon, project, conversation, body.id, bytes);
      return reply({ status: "sent" }, 200);
    } catch (error) {
      console.error(
        error instanceof ApiError
          ? `Photon image error ${error.status} (request ${error.requestId ?? "unknown"}).`
          : "Photon image failed.",
      );
      return reply({ status: "sent_without_image" }, 200);
    }
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
