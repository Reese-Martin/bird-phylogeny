import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNexus } from '../../scripts/tree-parser';
import type { TreeData } from '../../src/types';

const tree: TreeData = JSON.parse(readFileSync('public/data/tree.json', 'utf8'));

describe('pinned source tree preservation', () => {
  it('changes taxonomy labels without changing any source-tree geometry or annotations', () => {
    const source = parseNexus(readFileSync('data/raw/tree.nex', 'utf8'));
    const { sourceClades: _clades, nodes, ...prepared } = tree;
    const { nodes: sourceNodes, ...sourceHeader } = source;
    expect(prepared).toEqual(sourceHeader);
    expect(nodes.map(({ taxonCode: _code, ...node }) => node)).toEqual(sourceNodes);
  });
});
