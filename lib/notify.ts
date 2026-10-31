import type { IncidentInput } from "./incident";

export type NotifyRequest = {
  id: string;
  category: string;
  time: number;
  // Stream id of the footage this came from.
  source: string;
  // Base64 JPEG of what was detected. Sent as-is when there is no incident.
  image?: string;
  // The whole frame with zone and boxes. The server renders the incident card
  // from it and sends that instead of the crop.
  incident?: IncidentInput;
} & (
  | { kind: "zone"; count: number }
  | { kind: "luggage"; alone: number }
  | { kind: "crowd"; count: number; limit: number }
);

export type NotifyStatus =
  | "sent"
  | "sent_without_image"
  | "not_configured"
  | "invalid"
  | "rate_limited"
  | "no_conversation"
  | "failed";

export type NotifyResponse = { status: NotifyStatus };
