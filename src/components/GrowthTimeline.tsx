import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { clampGrowthIndex, GROWTH_SPEEDS, normalizeGrowthSpeed, scheduleGrowthStep, type GrowthTimeline as GrowthTimelineData } from '../arboretum/growth';
import './GrowthTimeline.css';

const readReducedMotion = () => {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);
  useEffect(() => {
    let media: MediaQueryList;
    try { media = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return; }
    const update = () => setReduced(media.matches); update();
    if (media.addEventListener) { media.addEventListener('change', update); return () => media.removeEventListener('change', update); }
    media.addListener?.(update); return () => media.removeListener?.(update);
  }, []);
  return reduced;
}

export interface GrowthTimelineProps {
  timeline: GrowthTimelineData;
  index: number;
  playing: boolean;
  speed: number;
  onIndexChange: (index: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onClose: () => void;
  countryName?: string;
  throughYear?: number | null;
  reducedMotion?: boolean;
  viewControls?: ReactNode;
  title?: string;
  prominentCount?: boolean;
}

const formatDate = (date: string) => new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export function GrowthTimeline({ timeline, index, playing, speed, onIndexChange, onPlayingChange, onSpeedChange, onClose, countryName, throughYear, reducedMotion: requestedReducedMotion, viewControls, title = 'Life list growth', prominentCount = false }: GrowthTimelineProps) {
  const systemReducedMotion = usePrefersReducedMotion();
  const reducedMotion = requestedReducedMotion ?? systemReducedMotion;
  const current = clampGrowthIndex(index, timeline.events.length), event = timeline.events[current];
  const complete = timeline.events.length > 0 && current === timeline.events.length - 1;
  const rangeId = useId(), speedId = useId();
  const callbacks = useRef({ onIndexChange, onPlayingChange }); callbacks.current = { onIndexChange, onPlayingChange };
  const latest = useRef({ timeline, current, playing, speed }); latest.current = { timeline, current, playing, speed };

  useEffect(() => {
    if (!playing) return;
    if (typeof document !== 'undefined' && document.hidden) { callbacks.current.onPlayingChange(false); return; }
    return scheduleGrowthStep({
      timeline, index: current, speed,
      onAdvance: next => callbacks.current.onIndexChange(next),
      onComplete: () => callbacks.current.onPlayingChange(false),
      isCurrent: () => latest.current.timeline === timeline && latest.current.current === current && latest.current.playing && latest.current.speed === speed && (typeof document === 'undefined' || !document.hidden),
    });
  }, [timeline, current, playing, speed]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const pauseHidden = () => { if (document.hidden) callbacks.current.onPlayingChange(false); };
    document.addEventListener('visibilitychange', pauseHidden);
    return () => document.removeEventListener('visibilitychange', pauseHidden);
  }, []);
  useEffect(() => { if (reducedMotion) callbacks.current.onPlayingChange(false); }, [reducedMotion]);

  const seek = (next: number) => { onPlayingChange(false); onIndexChange(clampGrowthIndex(next, timeline.events.length)); };
  const playPause = () => {
    if (playing) { onPlayingChange(false); return; }
    if (complete) onIndexChange(-1);
    onPlayingChange(true);
  };
  const restart = () => { onIndexChange(-1); onPlayingChange(!reducedMotion); };
  const dateLabel = event ? formatDate(event.date) : 'Before your first record';
  const count = event?.total || 0;

  return <section className="growth-timeline" aria-label="Life list growth animation" data-growth-index={current} data-growth-playing={playing} data-growth-events={timeline.events.length}>
    <div className="growth-heading">
      <div><strong>{title}</strong><span>{countryName || 'All countries'}{throughYear != null ? ` · through ${throughYear}` : ''}</span></div>
      <button type="button" className="growth-close" onClick={onClose}>Exit animation</button>
    </div>
    {viewControls && <div className="growth-view-controls">{viewControls}</div>}
    <div className="growth-transport">
      <div className="growth-player-row">
        <div className="growth-buttons" role="group" aria-label="Animation playback">
          <button type="button" className="growth-play" disabled={!timeline.events.length} onClick={playPause} aria-label={playing ? 'Pause animation' : complete ? 'Replay animation' : 'Play animation'}>{playing ? 'Pause' : complete ? 'Replay' : 'Play'}</button>
          <button type="button" onClick={restart} disabled={!timeline.events.length} aria-label="Restart animation">Restart</button>
          <button type="button" onClick={() => seek(current - 1)} disabled={current < 0} aria-label="Previous sighting date" title="Previous sighting date">‹</button>
          <button type="button" onClick={() => seek(current + 1)} disabled={complete || !timeline.events.length} aria-label="Next sighting date" title="Next sighting date">›</button>
        </div>
        <label className="growth-speed" htmlFor={speedId}><span>Speed</span><select id={speedId} value={normalizeGrowthSpeed(speed)} onChange={event => onSpeedChange(normalizeGrowthSpeed(Number(event.target.value)))}>{GROWTH_SPEEDS.map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      </div>
      <div className="growth-status-row">
        <div className="growth-current" role="status" aria-live={playing ? 'off' : 'polite'}>
          <strong>{dateLabel}</strong>
          {prominentCount ? <div className="growth-species-counter" role="group" aria-label="Species seen so far" data-growth-species-count={count}>
            <strong>{count.toLocaleString()}</strong><span>of {timeline.datedCount.toLocaleString()} species seen</span>
          </div> : <span>{count.toLocaleString()} / {timeline.datedCount.toLocaleString()} species{complete && !playing ? ' · Complete' : ''}</span>}
        </div>
      </div>
    </div>
    <label className="growth-range" htmlFor={rangeId}><span className="visually-hidden">Sighting timeline</span><input id={rangeId} type="range" min={-1} max={Math.max(0,timeline.events.length - 1)} step={1} value={current} disabled={!timeline.events.length} aria-valuetext={`${dateLabel}; ${count.toLocaleString()} of ${timeline.datedCount.toLocaleString()} species`} onChange={event => seek(Number(event.target.value))}/></label>
    <div className="growth-scale"><span>{timeline.firstDate ? formatDate(timeline.firstDate) : 'No dated species to animate'}</span><span>{timeline.lastDate ? formatDate(timeline.lastDate) : ''}</span></div>
    <p className="growth-note">Species appear on their first recorded dates. Dates without additions are skipped.{timeline.undatedCount > 0 ? ` ${timeline.undatedCount.toLocaleString()} species without usable dates are excluded.` : ''}{reducedMotion && !playing ? ' Reduced motion is on. Press Play to animate.' : ''}</p>
  </section>;
}
