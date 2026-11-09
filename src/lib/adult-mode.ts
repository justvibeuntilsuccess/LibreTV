import type { AdultMode } from './types';

/** Whether a marked source belongs in the current content-range view. */
export function matchesAdultMode(isAdult: boolean | undefined, mode: AdultMode): boolean {
  if (mode === 'only') return isAdult === true;
  if (mode === 'exclude') return isAdult !== true;
  return true;
}
