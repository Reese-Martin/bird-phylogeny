import { describe, expect, it } from 'vitest';
import { boxesOverlap, orderCalloutStyle, outerOrderCallouts, overviewTreeRadius, rectangleDistance, treeOverlayBoxes } from '../src/tree/order-placement';

// Deliberately crowded source angles reproduce orders concentrated on one side
// of the phylogeny. Representatives still need a uniform external ring.
const orders = Array.from({ length: 26 }, (_, index) => ({ name: `Order ${index}`, angle: index === 25 ? Math.PI : -Math.PI / 2 + index * 0.035 }));

function fitted(width: number, height: number, hoveredOrder?: string) {
  const treeRadius = overviewTreeRadius(width, height);
  return { treeRadius, callouts: outerOrderCallouts(orders, { width, height, x: width / 2, y: height / 2, treeRadius, hoveredOrder }) };
}

describe('overview order sticker ring', () => {
  it.each([[904, 900], [968, 450], [360, 600], [390, 844], [360, 300], [390, 330]])('keeps complete hover cards outside the tree and viewport at %i × %i', (width, height) => {
    const { treeRadius, callouts } = fitted(width, height);
    expect(callouts.length).toBeGreaterThanOrEqual(4);
    expect(callouts.length).toBeLessThan(orders.length);
    const style = orderCalloutStyle(width, height);
    for (const { box } of callouts) {
      expect(box.x).toBeGreaterThanOrEqual(4);
      expect(box.y).toBeGreaterThanOrEqual(4);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 4);
      expect(box.y + box.height).toBeLessThanOrEqual(height - 4);
      expect(rectangleDistance(box, width / 2, height / 2)).toBeGreaterThanOrEqual(treeRadius * 1.12 + style.gap - 1e-8);
    }
    for (let i = 0; i < callouts.length; i++) for (let j = i + 1; j < callouts.length; j++) {
      expect(boxesOverlap(callouts[i].box, callouts[j].box, 4)).toBe(false);
    }
  });

  it('places representatives at equal angles and samples the source order evenly', () => {
    const { callouts } = fitted(904, 900);
    const step = Math.PI * 2 / callouts.length;
    for (let index = 1; index < callouts.length; index++) {
      expect(callouts[index].angle - callouts[index - 1].angle).toBeCloseTo(step, 12);
      expect(callouts[index].radius).toBe(callouts[0].radius);
    }
    const sourceIndices = callouts.map((callout) => orders.findIndex((order) => order.name === callout.order.name));
    const gaps = sourceIndices.map((index, slot) => (sourceIndices[(slot + 1) % sourceIndices.length] - index + orders.length) % orders.length);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it('promotes an omitted hovered order without moving any ring slots', () => {
    const before = fitted(904, 900).callouts;
    const missing = orders.find((order) => !before.some((callout) => callout.order.name === order.name))!;
    const after = fitted(904, 900, missing.name).callouts;
    expect(after.some((callout) => callout.order.name === missing.name)).toBe(true);
    expect(after.map(({ x, y, box }) => ({ x, y, box }))).toEqual(before.map(({ x, y, box }) => ({ x, y, box })));
    const hoveredAgain = fitted(904, 900, before[2].order.name).callouts;
    expect(hoveredAgain).toEqual(before);
  });

  it('clips panned cards instead of pulling them inward onto source branches', () => {
    const treeRadius = overviewTreeRadius(904, 900);
    const callouts = outerOrderCallouts(orders, { width: 904, height: 900, x: -80, y: 450, treeRadius });
    expect(callouts.length).toBeGreaterThan(0);
    for (const { box } of callouts) expect(rectangleDistance(box, -80, 450)).toBeGreaterThan(treeRadius * 1.12);
  });

  it('rotates the whole evenly spaced ring to avoid the scale caption', () => {
    const width = 904, height = 900;
    const treeRadius = overviewTreeRadius(width, height);
    const reserved = [{ x: 77, y: height - 63, width: 211, height: 35 }];
    const callouts = outerOrderCallouts(orders, { width, height, x: width / 2, y: height / 2, treeRadius, reserved });
    expect(callouts.length).toBe(fitted(width, height).callouts.length);
    for (const { box } of callouts) expect(boxesOverlap(box, reserved[0], 4)).toBe(false);
    const step = Math.PI * 2 / callouts.length;
    for (let index = 1; index < callouts.length; index++) expect(callouts[index].angle - callouts[index - 1].angle).toBeCloseTo(step, 12);
  });

  it.each([[904, 900], [360, 300], [390, 321], [390, 330]])('keeps enlarged order cards clear of both zoom controls and caption at %i × %i', (width, height) => {
    const treeRadius = overviewTreeRadius(width, height);
    const reserved = treeOverlayBoxes(width, height);
    const callouts = outerOrderCallouts(orders, { width, height, x: width / 2, y: height / 2, treeRadius, reserved });
    expect(callouts.length).toBeGreaterThanOrEqual(2);
    for (const { box } of callouts) {
      for (const overlay of reserved) expect(boxesOverlap(box, overlay, 4)).toBe(false);
      expect(rectangleDistance(box, width / 2, height / 2)).toBeGreaterThan(treeRadius * 1.12);
    }
  });
});
