export type ReplyAction = "solved" | "on_it" | "false_alarm";

// Which event a reply means: its incident number, the newest open one, or all.
export type ReplyTarget = string | "latest" | "all";

export type ReplyCommand = {
  id: string;
  action: ReplyAction;
  target: ReplyTarget;
};

export type RepliesResponse = { commands: ReplyCommand[] };

export type ReplyAckRequest = {
  replyId: string;
  action: ReplyAction;
  // Incident numbers the reply was applied to; empty if there was none to update.
  incidents: string[];
};

export const REPLY_LABELS: Record<ReplyAction, string> = {
  solved: "Solved",
  on_it: "On it",
  false_alarm: "False alarm",
};

// Longer texts are conversation, not commands.
const MAX_COMMAND_LENGTH = 60;

const NEGATED = /(^|[^\p{L}])(not|isn't|isnt|never)($|[^\p{L}])/u;

const PATTERNS: [ReplyAction, RegExp][] = [
  ["false_alarm", /false alarm/],
  ["on_it", /on it|on my way|working on it/],
  ["solved", /(^|[^\p{L}])(solved|resolved|fixed|done|handled)($|[^\p{L}])/u],
];

export function parseReply(id: string, text: string): ReplyCommand | null {
  const lower = text.trim().toLowerCase();
  if (lower.length === 0 || lower.length > MAX_COMMAND_LENGTH) return null;
  if (NEGATED.test(lower)) return null;
  const action = PATTERNS.find(([, pattern]) => pattern.test(lower))?.[0];
  if (!action) return null;
  const number = lower.match(/(^|[^\d])(\d{4})($|[^\d])/)?.[2];
  const all = /(^|[^\p{L}])(all)($|[^\p{L}])/u.test(lower);
  return { id, action, target: number ?? (all ? "all" : "latest") };
}
