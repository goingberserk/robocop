import type { Detection } from "./detection";

type Box = Detection["box"];

export type Track = {
  id: number;
  label: string;
  score: number;
  box: Box;
  firstSeen: number;
  lastSeen: number;
};

// Video seconds a track survives without a matching detection, by default.
// People walking past hide objects all the time.
const MAX_AGE = 2;
const MIN_IOU = 0.2;
// At a few frames a second a walking person can move clear of their old box,
// so a close centre still counts as a (weak) match.
const MAX_JUMP = 0.6;

export const iou = (a: Box, b: Box) => {
  const w = Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin);
  const h = Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const area = (box: Box) => (box.xmax - box.xmin) * (box.ymax - box.ymin);
  return inter / (area(a) + area(b) - inter);
};

const affinity = (a: Box, b: Box) => {
  const overlap = iou(a, b);
  if (overlap >= MIN_IOU) return overlap;
  const dx = (a.xmin + a.xmax - b.xmin - b.xmax) / 2;
  const dy = (a.ymin + a.ymax - b.ymin - b.ymax) / 2;
  const reach = MAX_JUMP * Math.max(a.ymax - a.ymin, b.ymax - b.ymin);
  const distance = Math.hypot(dx, dy);
  return distance < reach ? 0.01 * (1 - distance / reach) : 0;
};

// Gives detections stable ids across frames by greedily matching each new
// detection to the existing track of the same kind it overlaps most.
export class Tracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private lastTime = -Infinity;
  private maxAge: Record<string, number>;
  private kinds: Record<string, string>;

  constructor({
    maxAge = {},
    kinds = {},
  }: {
    // Keeps some labels alive longer, such as objects that only move when
    // someone carries them.
    maxAge?: Record<string, number>;
    // Labels the model confuses, such as backpack and handbag, mapped to one
    // kind so a track survives the label flipping between them.
    kinds?: Record<string, string>;
  } = {}) {
    this.maxAge = maxAge;
    this.kinds = kinds;
  }

  private kind(label: string) {
    return this.kinds[label] ?? label;
  }

  update(detections: Detection[], time: number): Track[] {
    // The clip looped or was seeked backwards.
    if (time < this.lastTime) this.reset();
    this.lastTime = time;

    const pairs: { track: Track; detection: Detection; score: number }[] = [];
    for (const track of this.tracks) {
      for (const detection of detections) {
        if (this.kind(detection.label) !== this.kind(track.label)) continue;
        const score = affinity(track.box, detection.box);
        if (score > 0) pairs.push({ track, detection, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    const matchedTracks = new Set<Track>();
    const matchedDetections = new Set<Detection>();
    for (const { track, detection } of pairs) {
      if (matchedTracks.has(track) || matchedDetections.has(detection)) continue;
      matchedTracks.add(track);
      matchedDetections.add(detection);
      track.label = detection.label;
      track.box = detection.box;
      track.score = detection.score;
      track.lastSeen = time;
    }

    for (const detection of detections) {
      if (matchedDetections.has(detection)) continue;
      this.tracks.push({
        id: this.nextId++,
        label: detection.label,
        score: detection.score,
        box: detection.box,
        firstSeen: time,
        lastSeen: time,
      });
    }

    this.tracks = this.tracks.filter(
      (t) => time - t.lastSeen <= (this.maxAge[t.label] ?? MAX_AGE),
    );
    return this.tracks;
  }

  reset() {
    this.tracks = [];
    this.lastTime = -Infinity;
  }
}
