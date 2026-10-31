// Coordinates are fractions of the video frame (0-1), so zones survive resizing.
export type Point = { x: number; y: number };

export function contains(polygon: Point[], { x, y }: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

type Box = { xmin: number; ymin: number; xmax: number; ymax: number };

// A box counts as inside the zone when its bottom centre is: that is roughly
// where the object touches the ground.
export const boxInZone = (
  box: Box,
  zone: Point[],
  width: number,
  height: number,
) =>
  contains(zone, {
    x: (box.xmin + box.xmax) / 2 / width,
    y: box.ymax / height,
  });
