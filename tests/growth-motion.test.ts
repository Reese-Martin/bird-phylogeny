import { describe, expect, it } from 'vitest';
import { createGrowthMotion, growthMotionRawProgress, sampleGrowthMotion, updateGrowthMotion, type GrowthMotionState, type GrowthMotionUpdate } from '../src/tree/growth-motion';

const event = (state: GrowthMotionState, input: Partial<GrowthMotionUpdate> = {}) => updateGrowthMotion(state, { key: 'first', count: 1, newCount: 1, duration: 400, now: 1000, ...input });

describe('continuous branch-growth clock', () => {
  it('starts forward additions at zero and eases continuously to the exact endpoint', () => {
    const state = event(createGrowthMotion());
    expect(state.forward).toBe(true); expect(state.settled).toBe(false);
    expect(sampleGrowthMotion(state, 1000)).toBe(0);
    expect(sampleGrowthMotion(state, 1100)).toBeCloseTo(.15625);
    expect(sampleGrowthMotion(state, 1200)).toBe(.5);
    expect(sampleGrowthMotion(state, 1300)).toBeCloseTo(.84375);
    expect(sampleGrowthMotion(state, 1400)).toBe(1);
    expect(sampleGrowthMotion(state, 900)).toBe(0); expect(sampleGrowthMotion(state, 5000)).toBe(1);
    const samples = Array.from({ length: 41 }, (_, i) => sampleGrowthMotion(state, 1000 + i * 10));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
  });

  it('does not reset a live event when unrelated renders synchronize it', () => {
    const state = event(createGrowthMotion());
    const synchronized = event(state, { now: 1100 });
    expect(synchronized).toBe(state); expect(sampleGrowthMotion(synchronized, 1200)).toBe(.5);
  });

  it('settles a paused/exported frame so a quick resume cannot retract its branches', () => {
    const growing = event(createGrowthMotion());
    const paused = event(growing, { progress: 1, now: 1050 });
    expect(sampleGrowthMotion(paused, 1050)).toBe(1);
    const resumed = event(paused, { now: 1060 });
    expect(resumed.settled).toBe(true); expect(resumed.forward).toBe(false);
    expect(sampleGrowthMotion(resumed, 1060)).toBe(1); expect(sampleGrowthMotion(resumed, 2000)).toBe(1);
    const next = event(resumed, { key: 'next', count: 3, newCount: 2, now: 1200 });
    expect(sampleGrowthMotion(next, 1200)).toBe(0); expect(next.forward).toBe(true);
  });

  it('does not restart an explicitly stepped or reduced-motion event when motion is enabled', () => {
    const stepped = event(createGrowthMotion(), { progress: 1 });
    const enabled = event(stepped, { now: 1010 });
    expect(sampleGrowthMotion(enabled, 1010)).toBe(1);
    expect(sampleGrowthMotion(enabled, 1100)).toBe(1);
  });

  it('preserves the current fraction when speed changes and continues at the new rate', () => {
    const growing = event(createGrowthMotion());
    const slower = event(growing, { duration: 800, now: 1100 });
    expect(growthMotionRawProgress(slower, 1100)).toBe(.25);
    expect(sampleGrowthMotion(slower, 1100)).toBe(sampleGrowthMotion(growing, 1100));
    expect(growthMotionRawProgress(slower, 1300)).toBe(.5);
    const faster = event(slower, { duration: 200, now: 1300 });
    expect(growthMotionRawProgress(faster, 1300)).toBe(.5);
    expect(sampleGrowthMotion(faster, 1400)).toBe(1);
  });

  it('cannot restart completed growth when the speed changes', () => {
    const growing = event(createGrowthMotion());
    const slower = event(growing, { duration: 1600, now: 1400 });
    expect(slower.settled).toBe(true); expect(sampleGrowthMotion(slower, 1400)).toBe(1);
    expect(sampleGrowthMotion(slower, 2000)).toBe(1);
  });

  it('makes backward seeks and non-addition frames complete, then permits a later forward event', () => {
    const growing = event(createGrowthMotion(), { key: 'third', count: 3, newCount: 2 });
    const backward = event(growing, { key: 'second', count: 2, newCount: 1, now: 1100 });
    expect(backward.settled).toBe(true); expect(sampleGrowthMotion(backward, 1100)).toBe(1);
    const unchanged = event(backward, { key: 'same-count', count: 2, newCount: 0, now: 1200 });
    expect(unchanged.settled).toBe(true);
    const forward = event(unchanged, { key: 'third', count: 3, newCount: 1, now: 1300 });
    expect(forward.forward).toBe(true); expect(sampleGrowthMotion(forward, 1300)).toBe(0);
  });

  it('handles controlled progress and invalid durations without mutating prior state', () => {
    const original = createGrowthMotion(), snapshot = structuredClone(original);
    for (const duration of [0, -1, NaN, Infinity]) {
      const state = event(original, { duration });
      expect(state.duration).toBe(1); expect(sampleGrowthMotion(state, 1001)).toBe(1);
    }
    const forced = event(original, { progress: .25 });
    expect(sampleGrowthMotion(forced, 1000)).toBe(.25);
    expect(sampleGrowthMotion(event(original, { progress: NaN }), 1000)).toBe(1);
    expect(original).toEqual(snapshot);
  });
});
