// Which answer a drag on the swipe card means. Pure, so it can be tested.
//
// The top half of the screen is a fan of five star targets, measured as a
// compass bearing from the card's centre: 1★ straight left (270°), 2★ up-left
// (315°), 3★ straight up (0°), 4★ up-right (45°), 5★ straight right (90°).
// The bottom 135° means "haven't seen it": down-right (and straight down) =
// "haven't seen, maybe" (→ To decide), down-left = "haven't seen, not for me".
// Left is the low side, as with the stars.
export type SwipeAnswer = { kind: "stars"; stars: 1 | 2 | 3 | 4 | 5 } | { kind: "unseen" } | { kind: "pass" };

export const MIN_DISTANCE = 90; // px of travel before a drag counts

// 0° = up, 90° = right, 180° = down, 270° = left.
export function bearing(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function directionFor(dx: number, dy: number): SwipeAnswer | null {
  if (Math.hypot(dx, dy) < MIN_DISTANCE) return null;
  const b = bearing(dx, dy);
  if (b > 112.5 && b < 247.5) return b > 180 ? { kind: "pass" } : { kind: "unseen" };
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

// Where the two "haven't seen" targets sit, for flying the card off after a tap.
export const UNSEEN_BEARING = 135;
export const PASS_BEARING = 225;

// Long-press re-rating on the Search grid: the finger's position across the
// poster → stars in half steps. Left of the first half star = cancel (null).
export function starsFromX(x: number, width: number): number | null {
  if (width <= 0) return null;
  const frac = Math.min(1, x / width);
  if (frac < 0.05) return null;
  return Math.max(0.5, Math.min(5, Math.ceil(frac * 10) / 2));
}
