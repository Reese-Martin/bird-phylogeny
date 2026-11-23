import type { SpeciesObservation } from '../types';

export interface GrowthEvent {
  date: string;
  /** Species first recorded on this date, in stable code order. */
  codes: string[];
  total: number;
  /** Combined visible additions when several country trees share this date. */
  activityCount?: number;
}
export interface GrowthTimeline {
  events: GrowthEvent[];
  datedCount: number;
  undatedCount: number;
  totalSpecies: number;
  excludedAfterEndCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

const validFirstDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) || value === '1900-01-01') return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};

/**
 * Uses only the supplied collection/country's first-recorded dates. It never
 * infers sightings from a different country or assigns a date to unknown rows.
 */
export function buildGrowthTimeline(observations: readonly SpeciesObservation[], endYear?: number | null): GrowthTimeline {
  if (endYear != null && (!Number.isInteger(endYear) || endYear < 1000 || endYear > 9999)) throw new Error('Growth cutoff must be a valid calendar year.');
  const firstDates = new Map<string, string | null>();
  for (const observation of observations) {
    if (!observation.code.trim() || observation.code.startsWith('unresolved:')) continue;
    const date = validFirstDate(observation.earliestDate) ? observation.earliestDate : null;
    if (!firstDates.has(observation.code)) firstDates.set(observation.code, date);
    else {
      const previous = firstDates.get(observation.code);
      if (date && (!previous || date < previous)) firstDates.set(observation.code, date);
    }
  }
  const byDate = new Map<string, string[]>();
  let undatedCount = 0, excludedAfterEndCount = 0;
  for (const [code, date] of firstDates) {
    if (!date) { undatedCount++; continue; }
    if (endYear != null && Number(date.slice(0, 4)) > endYear) { excludedAfterEndCount++; continue; }
    const codes = byDate.get(date) || []; codes.push(code); byDate.set(date, codes);
  }
  let total = 0;
  const events = [...byDate].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([date, codes]) => {
    codes.sort((a, b) => a < b ? -1 : a > b ? 1 : 0); total += codes.length;
    return { date, codes, total };
  });
  return { events, datedCount: total, undatedCount, totalSpecies: firstDates.size, excludedAfterEndCount, firstDate: events[0]?.date || null, lastDate: events.at(-1)?.date || null };
}

export function clampGrowthIndex(index: number, eventCount: number): number {
  const last = Math.max(-1, Math.trunc(Number.isFinite(eventCount) ? eventCount : 0) - 1);
  return Number.isNaN(index) ? -1 : Math.max(-1, Math.min(last, Math.floor(index)));
}

export function codesThroughEvent(timeline: GrowthTimeline, index: number): Set<string> {
  const codes = new Set<string>(), last = clampGrowthIndex(index, timeline.events.length);
  for (let event = 0; event <= last; event++) for (const code of timeline.events[event].codes) codes.add(code);
  return codes;
}

export function nextGrowthIndex(timeline: GrowthTimeline, index: number): number | null {
  const current = clampGrowthIndex(index, timeline.events.length);
  return current < timeline.events.length - 1 ? current + 1 : null;
}

export const GROWTH_SPEEDS = [.5, 1, 2, 4] as const;
export const normalizeGrowthSpeed = (speed: number): number => GROWTH_SPEEDS.includes(speed as typeof GROWTH_SPEEDS[number]) ? speed : 1;

/** Date steps, not calendar days. Leave enough time to trace each new branch. */
export function growthStepDelay(speed: number, eventCount: number): number {
  const count = Math.max(1, Number.isFinite(eventCount) ? Math.trunc(eventCount) : 1);
  return Math.max(1, Math.round(Math.max(320, Math.min(1200, 54000 / count)) / normalizeGrowthSpeed(speed)));
}

/** Finish the growing stroke before the next date, with a short resting interval. */
export function growthTransitionDuration(speed: number, eventCount: number): number {
  return Math.max(1, Math.round(growthStepDelay(speed,eventCount) * .9));
}

/**
 * Give busy dates more drawing time without stretching the empty calendar gaps.
 * Sublinear weighting retains visible bursts while reducing their additions/sec
 * contrast against a one-bird date. The selected speed scales every date alike.
 */
export function growthEventDelay(timeline: GrowthTimeline, index: number, speed: number): number {
  const current=clampGrowthIndex(index,timeline.events.length);
  const event=timeline.events[current];
  if(!event)return Math.max(1,Math.round(120/normalizeGrowthSpeed(speed)));
  const supplied=event.activityCount;
  const activity=typeof supplied==='number'&&Number.isFinite(supplied)&&supplied>=0?supplied:event.codes.length;
  const delay=Math.max(160,Math.min(2200,100+110*Math.pow(activity,.65)));
  return Math.max(1,Math.round(delay/normalizeGrowthSpeed(speed)));
}

/** Almost all of an event is spent drawing, with only a minimal settling gap. */
export function growthEventTransitionDuration(timeline: GrowthTimeline, index: number, speed: number): number {
  const delay=growthEventDelay(timeline,index,speed);
  return Math.max(1,Math.min(delay-1,Math.round(delay*.99)));
}

export interface GrowthStepOptions {
  timeline: GrowthTimeline;
  index: number;
  speed: number;
  onAdvance: (index: number) => void;
  onComplete: () => void;
  /** Guards a callback which belongs to an obsolete scope, seek or play state. */
  isCurrent?: () => boolean;
}

/** One cancellable date step. Completion never schedules a hidden replay loop. */
export function scheduleGrowthStep({ timeline, index, speed, onAdvance, onComplete, isCurrent }: GrowthStepOptions): () => void {
  const next = nextGrowthIndex(timeline, index);
  if (!timeline.events.length) { if (!isCurrent || isCurrent()) onComplete(); return () => {}; }
  let cancelled = false;
  const timer = setTimeout(() => {
    if (cancelled || isCurrent && !isCurrent()) return;
    // Reaching the final date still starts its branch transition. The following
    // invocation holds that frame for one interval before stopping playback.
    if (next === null) onComplete();
    else onAdvance(next);
  }, growthEventDelay(timeline,index,speed));
  return () => { cancelled = true; clearTimeout(timer); };
}
