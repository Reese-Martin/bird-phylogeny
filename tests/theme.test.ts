import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function environment(systemDark = false, stored?: string, blocked = false) {
  const values = new Map<string, string>(stored === undefined ? [] : [['birds-and-trees-theme', stored]]);
  const storage = {
    getItem: vi.fn((key: string) => { if (blocked) throw new Error('Storage unavailable'); return values.get(key) ?? null; }),
    setItem: vi.fn((key: string, value: string) => { if (blocked) throw new Error('Storage unavailable'); values.set(key, value); }),
    removeItem: vi.fn((key: string) => { if (blocked) throw new Error('Storage unavailable'); values.delete(key); }),
  };
  const mediaListeners = new Set<() => void>();
  const media = { matches: systemDark, addEventListener: vi.fn((_type: string, callback: () => void) => mediaListeners.add(callback)) };
  const browser = Object.assign(new EventTarget(), { localStorage: storage, matchMedia: vi.fn(() => media) });
  const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const meta = { setAttribute: vi.fn() };
  const document = { documentElement: element, querySelector: vi.fn(() => meta) };
  vi.stubGlobal('window', browser); vi.stubGlobal('document', document);
  return { browser, storage, media, element, meta, values,
    changeSystem(value: boolean) { media.matches = value; mediaListeners.forEach(callback => callback()); },
    changeStorage(key: string | null) { const event = new Event('storage'); Object.defineProperty(event, 'key', { value: key }); browser.dispatchEvent(event); },
  };
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('appearance preference and resolution', () => {
  it('accepts only saved light/dark choices and resolves system appearance separately', async () => {
    const { parseThemePreference, resolveTheme } = await import('../src/theme');
    expect(['light', 'dark', 'system', 'Dark', '', null, '{}'].map(parseThemePreference)).toEqual(['light', 'dark', 'system', 'system', 'system', 'system', 'system']);
    expect(resolveTheme('system', true)).toBe('dark'); expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light'); expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('starts from the OS and follows subsequent system changes', async () => {
    const env = environment(true), theme = await import('../src/theme');
    const notify = vi.fn(); theme.subscribeTheme(notify);
    expect(theme.getResolvedTheme()).toBe('dark'); expect(env.element.dataset).toMatchObject({ theme: 'dark', themePreference: 'system' });
    env.changeSystem(false);
    expect(theme.getResolvedTheme()).toBe('light'); expect(env.element.style.colorScheme).toBe('light'); expect(notify).toHaveBeenCalledOnce();
    expect(env.meta.setAttribute).toHaveBeenLastCalledWith('content', '#f6f4ef');
  });

  it('persists an explicit toggle, ignores OS changes until system appearance is restored', async () => {
    const env = environment(false), theme = await import('../src/theme');
    theme.setThemePreference('dark');
    expect(env.values.get(theme.THEME_STORAGE_KEY)).toBe('dark');
    env.changeSystem(true); env.changeSystem(false);
    expect(theme.getResolvedTheme()).toBe('dark'); expect(env.element.dataset.themePreference).toBe('dark');
    theme.setThemePreference('system');
    expect(env.values.has(theme.THEME_STORAGE_KEY)).toBe(false); expect(theme.getResolvedTheme()).toBe('light');
    env.changeSystem(true); expect(theme.getResolvedTheme()).toBe('dark');
  });

  it('keeps a session choice working when local storage is blocked', async () => {
    const env = environment(true, undefined, true), theme = await import('../src/theme');
    expect(theme.getResolvedTheme()).toBe('dark');
    expect(() => theme.setThemePreference('light')).not.toThrow();
    expect(theme.getResolvedTheme()).toBe('light'); expect(env.element.dataset.themePreference).toBe('light');
    env.changeSystem(false); env.changeSystem(true); expect(theme.getResolvedTheme()).toBe('light');
  });

  it('restores the saved choice and synchronizes relevant cross-tab storage changes only', async () => {
    const env = environment(false, 'dark'), theme = await import('../src/theme');
    expect(theme.getResolvedTheme()).toBe('dark');
    env.values.set(theme.THEME_STORAGE_KEY, 'light'); env.changeStorage('another-key');
    expect(theme.getResolvedTheme()).toBe('dark');
    env.changeStorage(theme.THEME_STORAGE_KEY); expect(theme.getResolvedTheme()).toBe('light');
    env.values.delete(theme.THEME_STORAGE_KEY); env.changeStorage(null); env.changeSystem(true);
    expect(theme.getResolvedTheme()).toBe('dark'); expect(env.element.dataset.themePreference).toBe('system');
  });

  it('notifies resolved-theme changes and removes component subscribers cleanly', async () => {
    const env = environment(false), theme = await import('../src/theme');
    const events: unknown[] = []; env.browser.addEventListener(theme.THEME_CHANGE_EVENT, event => events.push((event as CustomEvent).detail));
    const notify = vi.fn(), unsubscribe = theme.subscribeTheme(notify);
    theme.setThemePreference('dark');
    expect(events).toEqual([{ theme: 'dark', preference: 'dark' }]); expect(notify).toHaveBeenCalledOnce();
    unsubscribe(); theme.setThemePreference('light');
    expect(notify).toHaveBeenCalledOnce(); expect(env.element.dataset.theme).toBe('light');
  });
});

describe('prepaint appearance bootstrap', () => {
  it('uses the same preference and palette before application code loads, including blocked storage', () => {
    const script = readFileSync('index.html', 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)![1];
    for (const [stored, systemDark, blocked, expected] of [
      ['dark', false, false, 'dark'], ['light', true, false, 'light'], ['invalid', true, false, 'dark'], [undefined, true, true, 'dark'], [undefined, false, false, 'light'],
    ] as const) {
      const env = environment(systemDark, stored, blocked);
      runInNewContext(script, { localStorage: env.storage, window: env.browser, document: { documentElement: env.element, querySelector: () => env.meta } });
      expect(env.element.dataset.theme).toBe(expected); expect(env.element.style.colorScheme).toBe(expected);
      expect(env.meta.setAttribute).toHaveBeenLastCalledWith('content', expected === 'dark' ? '#17191c' : '#f6f4ef');
    }
  });
});
