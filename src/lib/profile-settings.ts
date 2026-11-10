'use client';

import { useAppStore, type AppSettings } from './store';

const DEFAULTS: Partial<AppSettings> = {
  adultMode: 'exclude',
  yellowFilter: true,
  adFilter: true,
  doubanEnabled: true,
  recommendSource: 'hot-list',
  autoplayNext: true,
  imageProxyMode: 'direct',
  customImageProxy: '',
};

export function applyProfileSettings(input: Record<string, unknown> | undefined, profileId: string, revision: number, userId: string): void {
  const marker = `libretv-profile-revision:${userId}:${profileId}`;
  try {
    if (localStorage.getItem(marker) === String(revision)) return;
  } catch {
    // If storage is unavailable, still apply the server-assigned profile in memory.
  }
  const patch: Partial<AppSettings> = { ...DEFAULTS };
  if (input) {
    if (input.adultMode === 'exclude' || input.adultMode === 'only' || input.adultMode === 'all') patch.adultMode = input.adultMode;
    for (const key of ['yellowFilter', 'adFilter', 'doubanEnabled', 'autoplayNext'] as const) {
      if (typeof input[key] === 'boolean') patch[key] = input[key];
    }
    if (input.recommendSource === 'douban' || input.recommendSource === 'bangumi' || input.recommendSource === 'hot-list') patch.recommendSource = input.recommendSource;
    if (input.imageProxyMode === 'direct' || input.imageProxyMode === 'proxy' || input.imageProxyMode === 'custom') patch.imageProxyMode = input.imageProxyMode;
    if (typeof input.customImageProxy === 'string') patch.customImageProxy = input.customImageProxy;
  }
  useAppStore.getState().updateSettings(patch);
  try { localStorage.setItem(marker, String(revision)); } catch { /* ignore unavailable storage */ }
}
