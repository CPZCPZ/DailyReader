import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ReaderSettings {
  /** 阅读区字号（px），作用于 epub/docx/md/txt/html */
  fontSize: number;
  lineHeight: number;
  serif: boolean;
}

interface SettingsState extends ReaderSettings {
  theme: ThemeMode;
  /** GitHub 同步配置 */
  token: string;
  owner: string;
  repo: string;
  deviceName: string;
  lastSyncAt: number | null;
  setTheme: (t: ThemeMode) => void;
  setReader: (patch: Partial<ReaderSettings>) => void;
  setSync: (patch: Partial<Pick<SettingsState, 'token' | 'owner' | 'repo' | 'deviceName'>>) => void;
  setLastSyncAt: (t: number) => void;
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android 设备';
  if (/iPhone|iPad/i.test(ua)) return 'iOS 设备';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return '我的设备';
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      fontSize: 18,
      lineHeight: 1.8,
      serif: false,
      token: '',
      owner: '',
      repo: 'reader-data',
      deviceName: defaultDeviceName(),
      lastSyncAt: null,
      setTheme: (theme) => set({ theme }),
      setReader: (patch) => set(patch),
      setSync: (patch) => set(patch),
      setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
    }),
    {
      name: 'dailyreader-settings',
      // token 存在 localStorage：自用场景可接受，见计划中的安全说明
      partialize: (s) => ({
        theme: s.theme,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        serif: s.serif,
        token: s.token,
        owner: s.owner,
        repo: s.repo,
        deviceName: s.deviceName,
        lastSyncAt: s.lastSyncAt,
      }),
    },
  ),
);

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** 将主题应用到 <html> 的 class，Tailwind dark variant 依赖它 */
export function applyThemeClass(mode: ThemeMode) {
  const effective = resolveTheme(mode);
  document.documentElement.classList.toggle('dark', effective === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effective === 'dark' ? '#0f172a' : '#f8fafc');
}
