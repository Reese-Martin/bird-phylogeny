import assert from 'node:assert/strict';

export interface PreparedNode {
  id: number; parent: number | null; children: number[]; length: number;
  distance: number; age: number; leafStart: number; leafEnd: number;
  name?: string; sourceName?: string; taxonCode?: string;
  sourceIndex?: number; posterior?: number; age95Hpd?: [number, number];
}

/** Read the single labelled tree in this pinned NEXUS release without reordering it.
 * Square-bracket annotations are retained on their source nodes. A TRANSLATE block
 * is rejected: this source has literal labels, and guessing translation is unsafe. */
export function parseNexus(input: string) {
  if (/\btranslate\b/i.test(input)) throw new Error('NEXUS TRANSLATE blocks require an explicit translation reader.');
  const declaration = input.match(/\bntax\s*=\s*(\d+)/i);
  const trees = [...input.matchAll(/\btree\s+[^=;]+\s*=/gi)];
  assert.equal(trees.length, 1, 'Expected exactly one tree');
  let pos = trees[0].index! + trees[0][0].length;
  const nodes: PreparedNode[] = [];
  const annotations: string[] = [];
  function whitespace() { while (/\s/.test(input[pos] || '') && pos < input.length) pos++; }
  function comment() {
    let depth = 0, text = '';
    do { const c = input[pos++]; if (!c) throw new Error('Unclosed annotation'); text += c; if (c === '[') depth++; if (c === ']') depth--; } while (depth);
    return text;
  }
  whitespace();
  while (input[pos] === '[') { comment(); whitespace(); }
  function node(parent: number | null): number {
    whitespace();
    const id = nodes.length;
    const n: PreparedNode = { id, parent, children: [], length: 0, distance: 0, age: 0, leafStart: 0, leafEnd: 0 };
    nodes.push(n);
    if (input[pos] === '(') {
      pos++;
      do { n.children.push(node(id)); whitespace(); if (input[pos] !== ',') break; pos++; } while (true);
      assert.equal(input[pos++], ')', `Missing closing parenthesis at ${pos - 1}`);
    }
    whitespace();
    let label = '';
    if (input[pos] === "'") {
      pos++;
      while (pos < input.length) { const c = input[pos++]; if (c === "'") { if (input[pos] === "'") { label += "'"; pos++; } else break; } else label += c; }
    } else {
      while (pos < input.length && !/[\s:,();\[\]]/.test(input[pos])) label += input[pos++];
    }
    if (label) { n.name = label.replaceAll('_', ' '); n.sourceName = label; }
    if (!n.children.length) assert.ok(label, `Unlabelled tip at ${pos}`);
    whitespace();
    let metadata = '';
    while (input[pos] === '[') { metadata += comment(); whitespace(); }
    if (input[pos] === ':') {
      pos++; whitespace(); let raw = '';
      while (pos < input.length && /[0-9.eE+\-]/.test(input[pos])) raw += input[pos++];
      n.length = Number(raw);
      assert.ok(raw && Number.isFinite(n.length) && n.length >= 0, `Invalid branch length ${raw}`);
      whitespace();
    } else if (parent !== null) throw new Error(`Missing branch length at ${label || id}`);
    while (input[pos] === '[') { metadata += comment(); whitespace(); }
    annotations[id] = metadata;
    const index = metadata.match(/\bindex=(\d+)/); if (index) n.sourceIndex = +index[1];
    const posterior = metadata.match(/\bposterior=([\d.eE+\-]+)/); if (posterior) n.posterior = +posterior[1];
    const hpd = metadata.match(/age_95%_HPD=\{([\d.eE+\-]+),([\d.eE+\-]+)\}/);
    if (hpd) n.age95Hpd = [+hpd[1], +hpd[2]];
    return id;
  }
  const root = node(null); whitespace(); assert.equal(input[pos], ';', 'Tree must end with a semicolon');
  const tips: number[] = [];
  function walk(id: number, distance: number) {
    const n = nodes[id]; n.distance = distance; n.leafStart = tips.length;
    if (!n.children.length) tips.push(id);
    else for (const c of n.children) walk(c, distance + nodes[c].length);
    n.leafEnd = tips.length;
  }
  walk(root, 0);
  const maxDistance = Math.max(...tips.map(i => nodes[i].distance));
  for (const n of nodes) n.age = Math.max(0, maxDistance - n.distance);
  assert.equal(tips.length, +(declaration?.[1] || tips.length), 'Tip count differs from NTAX');
  const names = tips.map(i => nodes[i].sourceName!); assert.equal(new Set(names).size, tips.length, 'Duplicate source tip names');
  return { version: 'Aves 1.7 · Clements 2025', root, nodes, tips, maxDistance };
}

export function validateTree(tree: ReturnType<typeof parseNexus>) {
  const { nodes, tips, root, maxDistance } = tree;
  const seen = new Set<number>(); let maxBranchError = 0;
  function visit(id: number) {
    assert.ok(!seen.has(id), 'Cycle or duplicate child'); seen.add(id);
    const n = nodes[id]; assert.equal(n.id, id); assert.ok(Number.isFinite(n.age));
    for (const child of n.children) {
      assert.equal(nodes[child].parent, id, 'Parent/child mismatch');
      const error = Math.abs(nodes[child].distance - n.distance - nodes[child].length);
      maxBranchError = Math.max(maxBranchError, error);
      assert.ok(error < 1e-10, 'Root distances do not preserve branch lengths');
      assert.ok(n.age + 1e-10 >= nodes[child].age, 'Negative age direction');
      visit(child);
    }
  }
  visit(root); assert.equal(seen.size, nodes.length, 'Disconnected nodes');
  const minDistance = Math.min(...tips.map(i => nodes[i].distance));
  // The source writes branch lengths to six decimal places. Summed rounding is
  // retained, never repaired into a different dated topology.
  const tipDistanceSpread = maxDistance - minDistance;
  assert.ok(tipDistanceSpread < 0.001, 'Unexpected departure from source ultrametricity');
  return { tipCount: tips.length, nodeCount: nodes.length, connected: true, acyclic: true, uniqueTipNames: true,
    maxBranchError, minRootTipDistance: minDistance, maxRootTipDistance: maxDistance, tipDistanceSpread,
    branchToleranceMya: 1e-10, ultrametricToleranceMya: 0.001,
    annotatedNodes: nodes.filter(n => n.sourceIndex !== undefined).length,
    posteriorNodes: nodes.filter(n => n.posterior !== undefined).length,
    ageIntervalNodes: nodes.filter(n => n.age95Hpd !== undefined).length };
}
