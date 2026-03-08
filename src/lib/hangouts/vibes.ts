export const HANGOUT_VIBE_KEYS = [
  'hidden_gem',
  'go_to',
  'celebration',
  'casual',
  'fancy',
  'late_night',
] as const;

export type HangoutVibeKey = (typeof HANGOUT_VIBE_KEYS)[number];

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function pushUnique(list: HangoutVibeKey[], value: HangoutVibeKey) {
  if (!list.includes(value)) list.push(value);
}

export function normalizeHangoutVibeTags(raw: string[] | null | undefined): HangoutVibeKey[] {
  const next: HangoutVibeKey[] = [];

  for (const value of raw ?? []) {
    const tag = normalizeToken(value);
    if (!tag) continue;

    if (tag.includes('hidden')) pushUnique(next, 'hidden_gem');
    if (tag.includes('go-to') || tag.includes('go to') || tag.includes('repeat')) pushUnique(next, 'go_to');
    if (tag.includes('celebrat') || tag.includes('birthday')) pushUnique(next, 'celebration');
    if (tag.includes('casual') || tag.includes('quick') || tag.includes('work') || tag.includes('vibes')) pushUnique(next, 'casual');
    if (tag.includes('fancy') || tag.includes('date night')) pushUnique(next, 'fancy');
    if (tag.includes('late')) pushUnique(next, 'late_night');
  }

  return next;
}

export function hangoutVibeLabel(value: HangoutVibeKey): string {
  switch (value) {
    case 'hidden_gem':
      return 'Hidden Gem';
    case 'go_to':
      return 'Go-To';
    case 'celebration':
      return 'Celebration';
    case 'casual':
      return 'Casual';
    case 'fancy':
      return 'Fancy';
    case 'late_night':
      return 'Late Night';
  }
}

export function hangoutMatchesVibeFilter(vibeKeys: HangoutVibeKey[], selectedVibe: string): boolean {
  if (selectedVibe === 'all') return true;
  return vibeKeys.includes(selectedVibe as HangoutVibeKey);
}

export function displayedVibeKeys(vibeKeys: HangoutVibeKey[], selectedVibe: string, max = 2): HangoutVibeKey[] {
  if (vibeKeys.length <= max) return vibeKeys;
  if (selectedVibe !== 'all' && vibeKeys.includes(selectedVibe as HangoutVibeKey)) {
    const prioritized: HangoutVibeKey[] = [selectedVibe as HangoutVibeKey];
    for (const key of vibeKeys) {
      if (prioritized.length >= max) break;
      if (!prioritized.includes(key)) prioritized.push(key);
    }
    return prioritized;
  }
  return vibeKeys.slice(0, max);
}
