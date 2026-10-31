import type { IncidentBox, IncidentInput } from "./incident";
import type { Point } from "./watch";

// The one line on the card, assembled from measured facts only: what, how
// many, which side of the zone it came in from, whether it is still moving,
// and for how long. No model, no canned strings.

export type Side = "left" | "right" | "far end" | "near side";
export type Motion = "moving" | "stopped";

// Which edge of the zone a box is closest to, in the zone's own extent. The
// camera looks into the scene, so the top edge reads as the far end.
export function entrySideOf(box: IncidentBox, zone: Point[]): Side | undefined {
  if (zone.length < 3) return undefined;
  const xs = zone.map((p) => p.x);
  const ys = zone.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = box.x + box.w / 2;
  const foot = box.y + box.h;
  const d: [number, Side][] = [
    [(cx - minX) / (maxX - minX || 1), "left"],
    [(maxX - cx) / (maxX - minX || 1), "right"],
    [(foot - minY) / (maxY - minY || 1), "far end"],
    [(maxY - foot) / (maxY - minY || 1), "near side"],
  ];
  d.sort((a, b) => a[0] - b[0]);
  // Only name a side when the object is clearly nearer one edge than the rest.
  return d[0][0] < 0.35 ? d[0][1] : undefined;
}

// Movement over roughly the last second, in fractions of the box height, so a
// person far from the camera counts the same as one up close.
export function motionOf(prev: IncidentBox | undefined, curr: IncidentBox): Motion | undefined {
  if (!prev) return undefined;
  const dx = curr.x + curr.w / 2 - (prev.x + prev.w / 2);
  const dy = curr.y + curr.h - (prev.y + prev.h);
  return Math.hypot(dx, dy) / Math.max(curr.h, 0.01) > 0.12 ? "moving" : "stopped";
}

const plural = (n: number, noun: string) =>
  n === 1 ? `1 ${noun}` : `${n} ${noun === "person" ? "people" : noun + "s"}`;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function sentenceFor(
  input: IncidentInput & { entrySide?: Side; motion?: Motion },
): string {
  if (input.kind === "luggage") {
    const alone = input.dwellSeconds ?? 0;
    const who =
      input.boxes.some((b) => b.label === "person")
        ? "someone is nearby but not with it"
        : "no one is within reach of it";
    return `${capitalize(input.category)} left alone for ${alone} s in ${input.title}; ${who}.`;
  }
  if (input.kind === "crowd") {
    const over = input.count - (input.limit ?? 0);
    return `${input.count} people in ${input.title}, ${over} over the limit of ${input.limit ?? 0}.`;
  }
  const parts = [`${capitalize(plural(input.count, input.category))} entered ${input.title}`];
  if (input.entrySide) parts.push(`from the ${input.entrySide}`);
  if (input.dwellSeconds !== undefined && input.dwellSeconds > 0) {
    parts.push(`${input.dwellSeconds} s ago`);
  }
  const tail =
    input.motion === "stopped"
      ? " and stopped"
      : input.motion === "moving"
        ? " and is still moving"
        : "";
  return `${parts.join(" ")}${tail}.`;
}
