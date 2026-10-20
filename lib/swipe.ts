// Which answer a drag on the swipe card means. Pure, so it can be tested.
//
// The top half of the screen is a fan of five star targets, measured as a
// compass bearing from the card's centre: 1★ straight left (270°), 2★ up-left
// (315°), 3★ straight up (0°), 4★ up-right (45°), 5★ straight right (90°).
// Anything pointing into the bottom 135° means "haven't seen it".
export type SwipeAnswer = { kind: "stars"; stars: 1 | 2 | 3 | 4 | 5 } | { kind: "unseen" };

export const MIN_DISTANCE = 90; // px of travel before a drag counts

// 0° = up, 90° = right, 180° = down, 270° = left.
export function bearing(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function directionFor(dx: number, dy: number): SwipeAnswer | null {
  if (Math.hypot(dx, dy) < MIN_DISTANCE) return null;
  const b = bearing(dx, dy);
  if (b > 112.5 && b < 247.5) return { kind: "unseen" };
  // Fold to -180..180 so left is -90 and the five targets sit at -90..90.
  const signed = b > 180 ? b - 360 : b;
  const clamped = Math.max(-90, Math.min(90, signed));
  const stars = (Math.round(clamped / 45) + 3) as 1 | 2 | 3 | 4 | 5;
  return { kind: "stars", stars };
}

// Where each star target sits (bearing in degrees), for drawing the fan and
// for flying the card off in the right direction after a tap.
export const STAR_BEARINGS: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 270, 2: 315, 3: 0, 4: 45, 5: 90 };

// Unit vector for a bearing (screen coordinates: y grows downwards).
export function vectorFor(bearingDeg: number): { x: number; y: number } {
  const r = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}
