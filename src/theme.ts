import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
export const THEME_STORAGE_KEY = 'birds-and-trees-theme';
export const THEME_CHANGE_EVENT = 'birds-and-trees-theme-change';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}

export function readThemePreference(): ThemePreference {
  try { return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return 'system'; }
}

let initialized = false;
let preference: ThemePreference = 'system';
let theme: Theme = 'light';
let media: MediaQueryList | undefined;
const subscribers = new Set<() => void>();

function applyTheme() {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17191c' : '#f6f4ef');
}

function publish() {
  const previous = theme;
  theme = resolveTheme(preference, media?.matches ?? false);
  applyTheme();
  subscribers.forEach(subscriber => subscriber());
  if (previous !== theme && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme, preference } }));
  }
}

function initialize() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  preference = readThemePreference();
  try { media = window.matchMedia('(prefers-color-scheme: dark)'); } catch { /* Light fallback without media-query support. */ }
  theme = resolveTheme(preference, media?.matches ?? false);
  applyTheme();
  if (media?.addEventListener) media.addEventListener('change', publish);
  else media?.addListener(publish);
  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) { preference = readThemePreference(); publish(); }
  });
}

export function getResolvedTheme(): Theme { initialize(); return theme; }

export function setThemePreference(next: ThemePreference): void {
  initialize();
  preference = parseThemePreference(next);
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch { /* Appearance still changes for this session when storage is unavailable. */ }
  publish();
}

export function subscribeTheme(subscriber: () => void): () => void {
  initialize(); subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}

const preferenceSnapshot = () => { initialize(); return `${preference}:${theme}`; };

export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, () => 'light');
}

export function useThemePreference() {
  const snapshot = useSyncExternalStore(subscribeTheme, preferenceSnapshot, () => 'system:light');
  const [selectedPreference, selectedTheme] = snapshot.split(':') as [ThemePreference, Theme];
  return { theme: selectedTheme, preference: selectedPreference, setPreference: setThemePreference };
}
