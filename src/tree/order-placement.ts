export interface CalloutBox { x: number; y: number; width: number; height: number }
export interface CalloutOrder { name: string; angle: number }
export interface OrderCallout<T extends CalloutOrder> {
  order: T;
  x: number;
  y: number;
  angle: number;
  radius: number;
  box: CalloutBox;
}

const TAU = Math.PI * 2;
const normalized = (angle: number) => ((angle + Math.PI / 2) % TAU + TAU) % TAU;

/** The full hover card is reserved, rather than moving neighboring cards on hover. */
export function orderCalloutStyle(width: number, height: number) {
  const compact = width < 550 || height < 500;
  return compact
    ? { width: 72, height: 84, size: 42, hoverSize: 52, imageOffset: -12, gap: 10, font: 8, countFont: 7 }
    : { width: 112, height: 112, size: 66, hoverSize: 82, imageOffset: -13, gap: 14, font: 10, countFont: 9 };
}

/** Leave an outer lane for callouts, including their entire enlarged hit boxes. */
export function overviewTreeRadius(width: number, height: number) {
  const style = orderCalloutStyle(width, height);
  const outerRadius = Math.min(width / 2 - style.width / 2, height / 2 - style.height / 2) - 12;
  return Math.max(18, (outerRadius - Math.hypot(style.width, style.height) / 2 - style.gap) / 1.12);
}

/** Fixed canvas furniture shares the same exclusion boxes as sticker placement. */
export function treeOverlayBoxes(width: number, height: number): CalloutBox[] {
  return width < 550
    ? [{ x: 8, y: 6, width: 255, height: 44 }, { x: 14, y: height - 150, width: 45, height: 130 }]
    : [{ x: 77, y: height - 63, width: 211, height: 35 }, { x: 22, y: height - 155, width: 45, height: 135 }];
}

export function boxesOverlap(a: CalloutBox, b: CalloutBox, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Distance to the nearest point of a rectangle, useful for the tree exclusion circle. */
export function rectangleDistance(box: CalloutBox, x: number, y: number) {
  return Math.hypot(Math.max(box.x - x, 0, x - box.x - box.width), Math.max(box.y - y, 0, y - box.y - box.height));
}

/**
 * Source-ordered cards occupy equal angular slots on a single outer circle.
 * Crowded views sample orders evenly; the picker and wedges retain every order.
 * Panning/zooming clips cards instead of clamping them onto the phylogeny.
 */
export function outerOrderCallouts<T extends CalloutOrder>(orders: readonly T[], options: {
  width: number;
  height: number;
  x: number;
  y: number;
  treeRadius: number;
  hoveredOrder?: string | null;
  reserved?: readonly CalloutBox[];
}): OrderCallout<T>[] {
  if (!orders.length) return [];
  const { width, height, x, y, treeRadius } = options;
  const style = orderCalloutStyle(width, height);
  const radius = treeRadius * 1.12 + Math.hypot(style.width, style.height) / 2 + style.gap;
  const minimumChord = Math.hypot(style.width + 8, style.height + 8);
  const capacity = minimumChord >= radius * 2 ? 1 : Math.floor(Math.PI / Math.asin(minimumChord / (radius * 2)));
  const count = Math.max(1, Math.min(orders.length, capacity));
  const sorted = [...orders].sort((a, b) => normalized(a.angle) - normalized(b.angle) || a.name.localeCompare(b.name));
  const indices = Array.from({ length: count }, (_, index) => Math.floor(index * sorted.length / count));
  const step = TAU / count;
  // Minimize aggregate displacement while retaining uniform spacing. This phase is
  // independent of hover, so an enlarged sticker never moves its own hit target.
  const differences = indices.map((index, slot) => sorted[index].angle - slot * step);
  let phase = Math.atan2(differences.reduce((sum, angle) => sum + Math.sin(angle), 0), differences.reduce((sum, angle) => sum + Math.cos(angle), 0));
  const boxAt = (angle: number): CalloutBox => ({ x: x + Math.cos(angle) * radius - style.width / 2, y: y + Math.sin(angle) * radius - style.height / 2, width: style.width, height: style.height });
  const fits = (box: CalloutBox) => box.x >= 4 && box.y >= 4 && box.x + box.width <= width - 4 && box.y + box.height <= height - 4
    && !(options.reserved || []).some((reserved) => boxesOverlap(box, reserved, 4));
  // A small common rotation can avoid the fixed scale/navigation furniture while
  // retaining equal spacing. Hover never participates in this calculation.
  const basePhase = phase;
  let bestVisible = -1;
  for (let offset = 0; offset <= 32; offset++) {
    for (const sign of offset ? [-1, 1] : [1]) {
      const candidate = basePhase + sign * offset * step / 64;
      const visible = indices.filter((_, slot) => fits(boxAt(candidate + slot * step))).length;
      if (visible > bestVisible) { bestVisible = visible; phase = candidate; }
    }
    if (bestVisible === count) break;
  }
  const hovered = sorted.findIndex((order) => order.name === options.hoveredOrder);
  if (hovered >= 0 && !indices.includes(hovered)) {
    let closestSlot = 0;
    let closestDistance = Infinity;
    indices.forEach((index, slot) => {
      const distance = Math.min(Math.abs(hovered - index), sorted.length - Math.abs(hovered - index));
      if (distance < closestDistance) { closestDistance = distance; closestSlot = slot; }
    });
    indices[closestSlot] = hovered;
  }
  return indices.map((index, slot): OrderCallout<T> => {
    const angle = phase + slot * step;
    const calloutX = x + Math.cos(angle) * radius;
    const calloutY = y + Math.sin(angle) * radius;
    return {
      order: sorted[index], x: calloutX, y: calloutY, angle, radius,
      box: { x: calloutX - style.width / 2, y: calloutY - style.height / 2, width: style.width, height: style.height },
    };
  }).filter(({ box }) => fits(box) && rectangleDistance(box, x, y) >= treeRadius * 1.12 + style.gap - 1e-8);
}
