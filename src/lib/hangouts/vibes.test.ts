import { describe, expect, it } from 'vitest';
import { hangoutMatchesVibeFilter, normalizeHangoutVibeTags } from '@/lib/hangouts/vibes';

describe('hangout vibe normalization and filtering', () => {
  it('maps celebration text to canonical key', () => {
    const keys = normalizeHangoutVibeTags(['Celebrating', 'Quick bite']);
    expect(keys).toContain('celebration');
  });

  it('does not match celebration when only go-to spot exists', () => {
    const keys = normalizeHangoutVibeTags(['Go-to spot']);
    expect(hangoutMatchesVibeFilter(keys, 'celebration')).toBe(false);
  });

  it('does not match celebration when no vibe tags exist', () => {
    expect(hangoutMatchesVibeFilter([], 'celebration')).toBe(false);
  });

  it('matches with_friends for legacy great vibes tags', () => {
    const keys = normalizeHangoutVibeTags(['Great vibes']);
    expect(keys).toContain('with_friends');
  });
});
