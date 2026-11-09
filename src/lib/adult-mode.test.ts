import { describe, expect, it } from 'vitest';
import { matchesAdultMode } from './adult-mode';

describe('matchesAdultMode', () => {
  it('excludes marked sources in exclude mode', () => {
    expect(matchesAdultMode(false, 'exclude')).toBe(true);
    expect(matchesAdultMode(undefined, 'exclude')).toBe(true);
    expect(matchesAdultMode(true, 'exclude')).toBe(false);
  });

  it('includes only marked sources in only mode', () => {
    expect(matchesAdultMode(true, 'only')).toBe(true);
    expect(matchesAdultMode(false, 'only')).toBe(false);
    expect(matchesAdultMode(undefined, 'only')).toBe(false);
  });

  it('includes both source kinds in all mode', () => {
    expect(matchesAdultMode(true, 'all')).toBe(true);
    expect(matchesAdultMode(false, 'all')).toBe(true);
    expect(matchesAdultMode(undefined, 'all')).toBe(true);
  });
});
