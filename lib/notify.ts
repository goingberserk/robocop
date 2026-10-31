export type NotifyRequest = {
  id: string;
  category: string;
  time: number;
  // Stream id of the footage this came from.
  source: string;
  // Base64 JPEG of what was detected.
  image?: string;
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
