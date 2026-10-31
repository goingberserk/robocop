import type { Point } from "./watch";

// Everything the incident card and the one-line description need. Built on
// the client from the frame the boxes were detected on, sent with the alert.
export type IncidentBox = {
  // Fractions of the frame (0-1), like zone points.
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  score: number;
};

export type IncidentInput = {
  kind: "zone" | "luggage" | "crowd";
  // What the zone protects, e.g. "Server aisle B". Falls back to the footage.
  title: string;
  // Where the frame came from, e.g. "Live camera" or "Airport security queue".
  camera: string;
  // ISO timestamp of the event.
  at: string;
  // Short id shown on the card, e.g. "0417".
  incident: string;
  // Base64 JPEG of the whole detected frame, no data: prefix.
  frame: string;
  frameWidth: number;
  frameHeight: number;
  zone: Point[];
  boxes: IncidentBox[];
  // Zone and crowd events: how many are inside. Luggage: how long the bag sat
  // alone is dwellSeconds.
  count: number;
  // Crowd events: how many were allowed.
  limit?: number;
  dwellSeconds?: number;
  category: string;
  // Measured on the client from the box and the zone; see lib/sentence.ts.
  entrySide?: "left" | "right" | "far end" | "near side";
  motion?: "moving" | "stopped";
  // One line for the card. When missing, it is assembled from the fields above.
  sentence?: string;
};

// A stable four-digit number from an event id, so the card and the text agree.
export function incidentNumber(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return String(h % 10000).padStart(4, "0");
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

// The fallback line when no description is available: the plain fact.
export function plainSentence(input: IncidentInput): string {
  if (input.kind === "luggage") {
    const secs = input.dwellSeconds ?? 0;
    return `${capitalize(input.category)} left alone for ${secs} seconds in ${input.title}.`;
  }
  if (input.kind === "crowd") {
    return `${input.count} people in ${input.title}, limit ${input.limit ?? 0}.`;
  }
  const n = input.count;
  return `${n} ${input.category}${n === 1 ? "" : "s"} in ${input.title}.`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
