import { ApiError, Photon } from "@photon-ai/api";
import { renderIncidentCard } from "@/lib/card/render";
import { OTHER_CATEGORIES, STREET_CATEGORIES } from "@/lib/detection";
import { formatClock, type IncidentInput } from "@/lib/incident";
import type { NotifyRequest, NotifyResponse } from "@/lib/notify";
import { findConversation, type Conversation } from "@/lib/photon";
import { sentenceFor } from "@/lib/sentence";
import { streams } from "@/lib/streams";

// This route is public and its key is not, so it only ever sends one fixed kind
// of text to one configured person, at a limited rate.
const MIN_INTERVAL_MS = 5_000;
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_FRAME_BYTES = 1_500_000;

const CATEGORIES = new Set([...STREET_CATEGORIES, ...OTHER_CATEGORIES]);

let conversation: Conversation | undefined;
let lastSentAt = 0;

const reply = (body: NotifyResponse, status: number) =>
  Response.json(body, { status });

const isSmallInteger = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < 100_000;

const isUnit = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= -0.5 && value <= 1.5;

const isShortString = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const hasValidKind = (body: Record<string, unknown>) => {
  if (body.kind === "luggage") return isSmallInteger(body.alone);
  if (!isSmallInteger(body.count) || body.count === 0) return false;
  return body.kind === "crowd" ? isSmallInteger(body.limit) : body.kind === "zone";
};

// The whole frame plus geometry, from which the card is drawn. Checked field
// by field because the route is public.
const isIncident = (value: unknown): value is IncidentInput => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const zone = v.zone as unknown[];
  const boxes = v.boxes as Record<string, unknown>[];
  return (
    (v.kind === "zone" || v.kind === "luggage" || v.kind === "crowd") &&
    isShortString(v.title, 60) &&
    isShortString(v.camera, 60) &&
    isShortString(v.at, 40) &&
    !Number.isNaN(Date.parse(v.at as string)) &&
    typeof v.incident === "string" &&
    /^\d{4}$/.test(v.incident) &&
    typeof v.frame === "string" &&
    v.frame.length <= MAX_FRAME_BYTES * 1.37 &&
    isSmallInteger(v.frameWidth) &&
    isSmallInteger(v.frameHeight) &&
    (v.frameWidth as number) >= 16 &&
    (v.frameHeight as number) >= 16 &&
    Array.isArray(zone) &&
    zone.length <= 64 &&
    zone.every((p) => {
      const q = p as Record<string, unknown>;
      return q && isUnit(q.x) && isUnit(q.y);
    }) &&
    Array.isArray(boxes) &&
    boxes.length <= 32 &&
    boxes.every(
      (b) =>
        b &&
        isUnit(b.x) &&
        isUnit(b.y) &&
        isUnit(b.w) &&
        isUnit(b.h) &&
        isShortString(b.label, 32) &&
        typeof b.score === "number",
    ) &&
    isSmallInteger(v.count) &&
    (v.limit === undefined || isSmallInteger(v.limit)) &&
    (v.dwellSeconds === undefined || isSmallInteger(v.dwellSeconds)) &&
    typeof v.category === "string" &&
    CATEGORIES.has(v.category) &&
    (v.entrySide === undefined ||
      ["left", "right", "far end", "near side"].includes(v.entrySide as string)) &&
    (v.motion === undefined || v.motion === "moving" || v.motion === "stopped") &&
    v.sentence === undefined
  );
};

const REPLY_HINT = 'Reply "solved", "on it" or "false alarm".';

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

// The text-only alert, used when no incident card was sent with the event.
const alertText = (body: NotifyRequest) => {
  const [title, detail] = alertLines(body);
  const stream = streams.find((s) => s.id === body.source)!;
  const minutes = Math.floor(body.time / 60);
  const seconds = String(Math.floor(body.time % 60)).padStart(2, "0");
  // A camera has no position in a recording to point at.
  const source = stream.clipUrl
    ? `${stream.label}, at ${minutes}:${seconds}`
    : stream.label;
  return `${title}\n${detail}\n\nSource: ${source}\n${REPLY_HINT}`;
};

const headingFor = (kind: IncidentInput["kind"]) =>
  kind === "luggage" ? "Left luggage" : kind === "crowd" ? "Crowded" : "Intrusion";

const isValid = (body: Record<string, unknown>): body is NotifyRequest =>
  hasValidKind(body) &&
  typeof body.id === "string" &&
  /^[0-9a-f-]{36}$/.test(body.id) &&
  streams.some((s) => s.id === body.source) &&
  typeof body.category === "string" &&
  CATEGORIES.has(body.category) &&
  typeof body.time === "number" &&
  body.time >= 0 &&
  (body.image === undefined || typeof body.image === "string") &&
  (body.incident === undefined || isIncident(body.incident));

// Only accept what the client is meant to send: a JPEG within the size limit.
function decodeJpeg(image: string, max: number): Uint8Array<ArrayBuffer> | undefined {
  const bytes = new Uint8Array(Buffer.from(image, "base64"));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isJpeg && bytes.length <= max ? bytes : undefined;
}

async function sendImage(
  photon: Photon,
  project: string,
  target: Conversation,
  id: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: "image/jpeg" | "image/png",
  filename: string,
) {
  const boundary = crypto.randomUUID();
  const metadata = JSON.stringify({ contentType, sizeBytes: bytes.length, filename });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
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

async function sendText(
  photon: Photon,
  project: string,
  target: Conversation,
  key: string,
  text: string,
  format: "plain" | "markdown",
) {
  await photon.projects.sendMessage({
    path: { id: project },
    headers: { "idempotency-key": key },
    body: { ...target, content: { type: "text", format, text } },
  });
}

// The header above the card: a bold first line, then the facts. Photon turns
// markdown into native iMessage styling; if this line rejects it, send plain.
async function sendHeader(
  photon: Photon,
  project: string,
  target: Conversation,
  id: string,
  incident: IncidentInput,
) {
  const facts = `${incident.camera} · ${formatClock(incident.at)} · #${incident.incident}\n${REPLY_HINT}`;
  const title = `${headingFor(incident.kind)} · ${incident.title}`;
  try {
    await sendText(photon, project, target, `zone-event:${id}`, `**${title}**\n${facts}`, "markdown");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status < 400 || error.status >= 500) throw error;
    console.error(`Photon rejected markdown (${error.status}); sending plain.`);
    await sendText(photon, project, target, `zone-event:${id}:plain`, `${title}\n${facts}`, "plain");
  }
}

const logImageError = (error: unknown) =>
  console.error(
    error instanceof ApiError
      ? `Photon image error ${error.status} (request ${error.requestId ?? "unknown"}).`
      : error instanceof Error
        ? `Image failed: ${error.message}`
        : "Image failed.",
  );

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

    // The incident card: a styled header, then the rendered PNG.
    if (body.incident && decodeJpeg(body.incident.frame, MAX_FRAME_BYTES)) {
      const incident: IncidentInput = {
        ...body.incident,
        sentence: sentenceFor(body.incident),
      };
      await sendHeader(photon, project, conversation, body.id, incident);
      try {
        const png = await renderIncidentCard(incident);
        await sendImage(
          photon,
          project,
          conversation,
          body.id,
          new Uint8Array(png.buffer, png.byteOffset, png.byteLength) as Uint8Array<ArrayBuffer>,
          "image/png",
          `incident-${incident.incident}.png`,
        );
        return reply({ status: "sent" }, 200);
      } catch (error) {
        logImageError(error);
        return reply({ status: "sent_without_image" }, 200);
      }
    }

    // Without a card: the text alert and the cropped detection.
    await sendText(
      photon,
      project,
      conversation,
      `zone-event:${body.id}`,
      alertText(body),
      "plain",
    );
    if (!body.image) return reply({ status: "sent_without_image" }, 200);
    try {
      const bytes = decodeJpeg(body.image, MAX_IMAGE_BYTES);
      if (!bytes) throw new Error("Invalid image.");
      await sendImage(photon, project, conversation, body.id, bytes, "image/jpeg", "detection.jpg");
      return reply({ status: "sent" }, 200);
    } catch (error) {
      logImageError(error);
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
