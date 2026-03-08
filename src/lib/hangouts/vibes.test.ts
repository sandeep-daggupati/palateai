import { describe, expect, it } from 'vitest';
import { displayedVibeKeys, hangoutMatchesVibeFilter, normalizeHangoutVibeTags } from '@/lib/hangouts/vibes';

describe('hangout vibe normalization and filtering', () => {
  it('includes celebration when tags contain celebration text', () => {
    const keys = normalizeHangoutVibeTags(['Celebrating', 'Quick bite']);
    expect(keys).toContain('celebration');
  });

  it('does not match celebration when only go_to exists', () => {
    const keys = normalizeHangoutVibeTags(['Go-to spot']);
    expect(hangoutMatchesVibeFilter(keys, 'celebration')).toBe(false);
  });

  it('does not match celebration when no vibe tags exist', () => {
    expect(hangoutMatchesVibeFilter([], 'celebration')).toBe(false);
  });

  it('prioritizes selected vibe in displayed badges', () => {
    const displayed = displayedVibeKeys(['casual', 'go_to', 'celebration'], 'celebration', 2);
    expect(displayed).toContain('celebration');
  });
});
