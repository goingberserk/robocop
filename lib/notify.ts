export type NotifyRequest = {
  id: string;
  category: string;
  count: number;
  time: number;
};

export type NotifyStatus =
  | "sent"
  | "not_configured"
  | "invalid"
  | "rate_limited"
  | "no_conversation"
  | "failed";

export type NotifyResponse = { status: NotifyStatus };
