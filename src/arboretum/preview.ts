import type { TreeData } from '../types';
import { collectAncestry, type TreeLayout } from '../tree/geometry';

export interface AncestryPreview { path: string; sourceTips: number; branches: number }
const coordinate = (value: number) => String(Number(value.toFixed(3)));

/** Small branch-only previews reuse one source layout; no portraits or fitting. */
export function ancestryPreview(tree: TreeData, layout: TreeLayout, tips: Iterable<number>): AncestryPreview {
  const validTips = new Set([...tips].filter(id => tree.nodes[id] && !tree.nodes[id].children.length));
  const ancestry = collectAncestry(tree, validTips);
  const point = (x: number, y: number) => `${coordinate(100 + x * 82)} ${coordinate(100 + y * 82)}`;
  const segments: string[] = [];
  for (const id of ancestry) {
    const node = tree.nodes[id];
    if (node.parent === null) continue;
    const parent = layout.nodes[node.parent], child = layout.nodes[id];
    let segment = `M${point(parent.x, parent.y)}`;
    if (parent.radius > 0) {
      const delta = child.angle - parent.angle, radius = coordinate(parent.radius * 82);
      segment += `A${radius} ${radius} 0 ${Math.abs(delta) > Math.PI ? 1 : 0} ${delta >= 0 ? 1 : 0} ${point(Math.cos(child.angle) * parent.radius, Math.sin(child.angle) * parent.radius)}`;
    }
    segments.push(`${segment}L${point(child.x, child.y)}`);
  }
  return { path: segments.join(''), sourceTips: validTips.size, branches: segments.length };
}
