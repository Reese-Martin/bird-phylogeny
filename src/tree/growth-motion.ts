export interface GrowthMotionState {
  key: string;
  count: number;
  started: number;
  duration: number;
  forward: boolean;
  settled: boolean;
  /** A controlled frame is exact; resuming that event subsequently stays complete. */
  forcedProgress?: number;
}

export interface GrowthMotionUpdate {
  key: string;
  count: number;
  newCount: number;
  duration: number;
  progress?: number;
  now: number;
}

const clampProgress = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
const durationMs = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;

export function createGrowthMotion(): GrowthMotionState {
  return { key: '', count: 0, started: 0, duration: 1, forward: false, settled: true };
}

/** Raw elapsed fraction, useful when changing speed without retracting a branch. */
export function growthMotionRawProgress(state: GrowthMotionState, now: number): number {
  if (state.forcedProgress !== undefined) return state.forcedProgress;
  if (state.settled || !state.forward) return 1;
  return clampProgress((now - state.started) / state.duration);
}

/** C1 easing starts and finishes gently without changing path order or endpoints. */
export function sampleGrowthMotion(state: GrowthMotionState, now: number): number {
  const progress = growthMotionRawProgress(state, now);
  return state.forcedProgress !== undefined ? progress : progress * progress * (3 - 2 * progress);
}

/**
 * Synchronize before the next paint. Pauses, seeks, exports and reduced motion
 * finish the current event; returning to automatic playback cannot rewind it.
 */
export function updateGrowthMotion(previous: GrowthMotionState, update: GrowthMotionUpdate): GrowthMotionState {
  const { key, count, newCount, now } = update;
  const duration = durationMs(update.duration);
  const newEvent = previous.key !== key || previous.count !== count;
  if (update.progress !== undefined) {
    return { key, count, started: now, duration, forward: false, settled: true, forcedProgress: clampProgress(update.progress) };
  }
  if (newEvent) {
    const forward = count > previous.count && newCount > 0;
    return { key, count, started: now, duration, forward, settled: !forward };
  }
  // An explicitly completed frame is permanently complete for this event.
  if (previous.settled || !previous.forward || previous.forcedProgress !== undefined) {
    return { key, count, started: previous.started, duration, forward: false, settled: true };
  }
  const raw = growthMotionRawProgress(previous, now);
  if (raw >= 1) return { key, count, started: previous.started, duration, forward: false, settled: true };
  if (duration === previous.duration) return previous;
  return { key, count, started: now - raw * duration, duration, forward: true, settled: false };
}
