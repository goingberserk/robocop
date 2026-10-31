import type { Detection } from "./detection";
import { iou, type Track } from "./tracker";
import { boxInZone, type Point } from "./watch";

export const LUGGAGE_CATEGORIES = ["suitcase", "backpack", "handbag"];

// Bags that are carried around move; one that stays put this long is set down.
const SETTLE_SECONDS = 1.5;
// How far a bag may drift, in bag sizes, before it counts as moved. Boxes
// jitter between frames.
const MOVE_TOLERANCE = 0.5;
// A person attends a bag when their feet are within this many of their own
// heights from where the bag touches the ground. Scaling by height roughly
// corrects for perspective.
const OWNER_REACH = 0.75;
// Cameras look down at an angle, so a gap up or down the image is much more
// distance on the floor than the same gap across it.
const DEPTH_WEIGHT = 1.5;
// Detections of a bag on the floor flicker in and out, and a new track would
// raise a second alert for the same bag. Bags only move when carried.
const BAG_MAX_AGE = 10;
// A bag track lives on unseen so the same bag keeps its id, but one hidden
// this long may have been carried off, so it no longer counts.
const HIDDEN_SECONDS = 2;
// Overlapping bag boxes this much are the same bag seen twice.
const DUPLICATE_IOU = 0.3;

// The model sometimes puts two boxes, often of different bag labels, on one
// bag. Keep only the most confident so each bag is tracked once.
export const dedupeBags = (detections: Detection[]) => {
  const kept: Detection[] = [];
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  for (const d of sorted) {
    const isBag = LUGGAGE_CATEGORIES.includes(d.label);
    const duplicate =
      isBag &&
      kept.some(
        (k) =>
          LUGGAGE_CATEGORIES.includes(k.label) &&
          iou(k.box, d.box) >= DUPLICATE_IOU,
      );
    if (!duplicate) kept.push(d);
  }
  return kept;
};

// Settings for a Tracker that follows bags through flickering detections.
export const BAG_TRACKING = {
  maxAge: Object.fromEntries(LUGGAGE_CATEGORIES.map((c) => [c, BAG_MAX_AGE])),
  kinds: Object.fromEntries(LUGGAGE_CATEGORIES.map((c) => [c, "bag"])),
};

// A bag whose owner was lost can be picked up again by whoever stands closest
// within this window, since the tracker loses people behind others.
const REUNITE_SECONDS = 3;

export type BagState = "moving" | "attended" | "unattended" | "abandoned";

export type Bag = {
  track: Track;
  state: BagState;
  ownerId: number | null;
  // Video seconds without an owner nearby; 0 unless unattended or abandoned.
  alone: number;
};

type Memory = {
  anchor: Point;
  settledSince: number;
  ownerId: number | null;
  aloneSince: number | null;
  alerted: boolean;
};

const centre = ({ box }: Track): Point => ({
  x: (box.xmin + box.xmax) / 2,
  y: (box.ymin + box.ymax) / 2,
});

const size = ({ box }: Track) =>
  Math.max(box.xmax - box.xmin, box.ymax - box.ymin);

// How close a person stands to a bag, in multiples of the person's height.
const reach = (person: Track, bag: Track) => {
  const dx = (person.box.xmin + person.box.xmax - bag.box.xmin - bag.box.xmax) / 2;
  const dy = person.box.ymax - bag.box.ymax;
  const height = person.box.ymax - person.box.ymin;
  return Math.hypot(dx, dy * DEPTH_WEIGHT) / height;
};

const nearest = (bag: Track, people: Track[]) => {
  let best: Track | null = null;
  let bestReach = OWNER_REACH;
  for (const person of people) {
    const r = reach(person, bag);
    if (r <= bestReach) {
      best = person;
      bestReach = r;
    }
  }
  return best;
};

// Decides for each tracked bag in the zone whether it is still with its owner.
// The owner is whoever is closest when the bag is first seen or set down; the
// bag is abandoned once that person has been away for `abandonAfter` seconds.
export class LuggageWatch {
  private memory = new Map<number, Memory>();

  update(
    tracks: Track[],
    {
      zone,
      width,
      height,
      time,
      abandonAfter,
    }: {
      zone: Point[];
      width: number;
      height: number;
      time: number;
      abandonAfter: number;
    },
  ): { bags: Bag[]; abandoned: Bag[] } {
    const people = tracks.filter((t) => t.label === "person");
    const peopleById = new Map(people.map((p) => [p.id, p]));
    const bags: Bag[] = [];
    const abandoned: Bag[] = [];
    const seen = new Set<number>();

    for (const track of tracks) {
      if (track.label === "person") continue;
      if (!boxInZone(track.box, zone, width, height)) continue;
      seen.add(track.id);
      if (time - track.lastSeen > HIDDEN_SECONDS) continue;

      let memory = this.memory.get(track.id);
      const moved =
        memory &&
        Math.hypot(
          centre(track).x - memory.anchor.x,
          centre(track).y - memory.anchor.y,
        ) >
          MOVE_TOLERANCE * size(track);
      if (!memory || moved) {
        memory = {
          anchor: centre(track),
          settledSince: time,
          ownerId: nearest(track, people)?.id ?? memory?.ownerId ?? null,
          aloneSince: null,
          alerted: false,
        };
        this.memory.set(track.id, memory);
      }

      const owner =
        memory.ownerId === null ? undefined : peopleById.get(memory.ownerId);
      let attended = owner !== undefined && reach(owner, track) <= OWNER_REACH;
      if (
        !attended &&
        (memory.aloneSince === null || time - memory.aloneSince < REUNITE_SECONDS)
      ) {
        const stranger = nearest(track, people);
        if (stranger) {
          memory.ownerId = stranger.id;
          attended = true;
        }
      }

      let state: BagState;
      if (time - memory.settledSince < SETTLE_SECONDS) {
        state = "moving";
        memory.aloneSince = null;
      } else if (attended) {
        state = "attended";
        memory.aloneSince = null;
      } else {
        memory.aloneSince ??= time;
        state =
          time - memory.aloneSince >= abandonAfter ? "abandoned" : "unattended";
      }

      const bag: Bag = {
        track,
        state,
        ownerId: attended ? memory.ownerId : null,
        alone: memory.aloneSince === null ? 0 : time - memory.aloneSince,
      };
      bags.push(bag);
      if (state === "abandoned" && !memory.alerted) {
        memory.alerted = true;
        abandoned.push(bag);
      }
    }

    for (const id of this.memory.keys()) {
      if (!seen.has(id)) this.memory.delete(id);
    }
    return { bags, abandoned };
  }

  reset() {
    this.memory.clear();
  }
}
