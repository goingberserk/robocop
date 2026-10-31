import type { Track } from "./tracker";
import { boxInZone, type Point } from "./watch";

export const LUGGAGE_CATEGORIES = ["suitcase", "backpack", "handbag"];

// Bags that are carried around move; one that stays put this long is set down.
const SETTLE_SECONDS = 1.5;
// How far a bag may drift, in bag sizes, before it counts as moved. Boxes
// jitter between frames.
const MOVE_TOLERANCE = 0.5;
// A person attends a bag when their feet are within this many of their own
// heights from it. Scaling by height roughly corrects for perspective.
const OWNER_REACH = 1;
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
  const feet = { x: (person.box.xmin + person.box.xmax) / 2, y: person.box.ymax };
  const { x, y } = centre(bag);
  const height = person.box.ymax - person.box.ymin;
  return Math.hypot(feet.x - x, feet.y - y) / height;
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
