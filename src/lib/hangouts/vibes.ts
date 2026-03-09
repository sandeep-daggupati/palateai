export const HANGOUT_VIBE_OPTIONS = [
  { key: 'quick_bite', label: 'Quick bite' },
  { key: 'go_to_spot', label: 'Go-to spot' },
  { key: 'celebration', label: 'Celebration' },
  { key: 'work_hangout', label: 'Work hangout' },
  { key: 'with_friends', label: 'With friends' },
  { key: 'night_out', label: 'Night out' },
  { key: 'hidden_gem', label: 'Hidden gem' },
] as const;

export type HangoutVibeKey = (typeof HANGOUT_VIBE_OPTIONS)[number]['key'];

export const HANGOUT_VIBE_KEYS = HANGOUT_VIBE_OPTIONS.map((option) => option.key) as HangoutVibeKey[];

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function pushUnique(list: HangoutVibeKey[], value: HangoutVibeKey) {
  if (!list.includes(value)) list.push(value);
}

export function hangoutVibeLabel(value: HangoutVibeKey): string {
  const option = HANGOUT_VIBE_OPTIONS.find((entry) => entry.key === value);
  return option?.label ?? value;
}

export function normalizeHangoutVibeTags(raw: string[] | null | undefined): HangoutVibeKey[] {
  const next: HangoutVibeKey[] = [];

  for (const value of raw ?? []) {
    const tag = normalizeToken(value);
    if (!tag) continue;

    // Backward compatible mapping from legacy values to the canonical 7 options.
    if (tag.includes('quick') || tag === 'casual') pushUnique(next, 'quick_bite');
    if (tag.includes('go-to') || tag.includes('go to') || tag.includes('repeat') || tag === 'go_to') pushUnique(next, 'go_to_spot');
    if (tag.includes('celebrat') || tag.includes('birthday')) pushUnique(next, 'celebration');
    if (tag.includes('work')) pushUnique(next, 'work_hangout');
    if (tag.includes('friend') || tag.includes('crew') || tag.includes('buddy') || tag.includes('vibes')) pushUnique(next, 'with_friends');
    if (tag.includes('night') || tag.includes('late') || tag.includes('fancy') || tag.includes('date')) pushUnique(next, 'night_out');
    if (tag.includes('hidden')) pushUnique(next, 'hidden_gem');

    // Already-canonical keys should still parse directly.
    if (HANGOUT_VIBE_KEYS.includes(tag as HangoutVibeKey)) pushUnique(next, tag as HangoutVibeKey);
  }

  return next;
}

export function hangoutMatchesVibeFilter(vibeKeys: HangoutVibeKey[], selectedVibe: string): boolean {
  if (selectedVibe === 'all') return true;
  return vibeKeys.includes(selectedVibe as HangoutVibeKey);
}
