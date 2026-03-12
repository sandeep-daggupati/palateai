import { Database } from '@/lib/supabase/types';
import { SupabaseClient } from '@supabase/supabase-js';

export type HighlightCard = {
  key: 'standout' | 'repeat' | 'memory';
  title: string;
  body: string;
  hint: string;
  href: string | null;
  image_label: string;
};

type PersonalRow = {
  dish_name: string;
  source_hangout_id: string | null;
  rating: number | null;
  created_at: string;
};

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function withinDays(value: string | null | undefined, now: Date, days: number): boolean {
  const stamp = parseTime(value);
  if (!stamp) return false;
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return stamp >= cutoff;
}

function dishKey(name: string): string {
  return name.trim().toLowerCase();
}

function shortDishName(value: string): string {
  return value.length > 30 ? `${value.slice(0, 30)}...` : value;
}

function fallbackCards(): HighlightCard[] {
  return [
    {
      key: 'standout',
      title: 'Standout',
      body: 'No top-rated dish yet this week.',
      hint: 'Rate a dish to unlock your standout',
      href: '/food',
      image_label: 'S',
    },
    {
      key: 'repeat',
      title: 'On Repeat',
      body: 'No repeat pattern yet.',
      hint: 'Log a dish twice this week to surface repeats',
      href: '/food',
      image_label: 'R',
    },
    {
      key: 'memory',
      title: 'Try Something New',
      body: "You haven't logged a new cuisine in 12 days.",
      hint: 'Try one new spot this week',
      href: '/add',
      image_label: 'N',
    },
  ];
}

export async function getHighlights(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<HighlightCard[]> {
  const now = new Date();

  const { data: rowsRaw } = await supabase
    .from('personal_food_entries')
    .select('dish_name,source_hangout_id,rating,created_at')
    .eq('user_id', userId)
    .or('had_it.eq.true,rating.not.is.null,reaction_tag.not.is.null,note.not.is.null,photo_path.not.is.null')
    .order('created_at', { ascending: false })
    .limit(1200);

  const rows = (rowsRaw ?? []) as PersonalRow[];
  if (rows.length === 0) return fallbackCards();

  const thisWeek = rows.filter((row) => withinDays(row.created_at, now, 7));
  const fallback = fallbackCards();

  let standout = fallback[0];
  const topRated = [...thisWeek]
    .filter((row) => typeof row.rating === 'number')
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  if (topRated) {
    standout = {
      key: 'standout',
      title: 'Standout',
      body: shortDishName(topRated.dish_name),
      hint: `Rated ${topRated.rating?.toFixed(1) ?? '4.0'} this week`,
      href: topRated.source_hangout_id ? `/uploads/${topRated.source_hangout_id}` : '/food',
      image_label: topRated.dish_name.slice(0, 1).toUpperCase(),
    };
  }

  let repeat = fallback[1];
  if (thisWeek.length > 0) {
    const counts = new Map<string, { count: number; row: PersonalRow }>();
    for (const row of thisWeek) {
      const key = dishKey(row.dish_name);
      const current = counts.get(key);
      if (!current) counts.set(key, { count: 1, row });
      else counts.set(key, { count: current.count + 1, row: current.row });
    }

    const maxEntry = Array.from(counts.values()).sort((a, b) => b.count - a.count)[0];
    const weeklyAverage = thisWeek.length / Math.max(1, counts.size);

    if (maxEntry && maxEntry.count > weeklyAverage) {
      repeat = {
        key: 'repeat',
        title: 'On Repeat',
        body: shortDishName(maxEntry.row.dish_name),
        hint: `${maxEntry.count}x this week vs ${weeklyAverage.toFixed(1)} avg`,
        href: '/food',
        image_label: maxEntry.row.dish_name.slice(0, 1).toUpperCase(),
      };
    }
  }

  const tryNew = fallback[2];
  return [standout, repeat, tryNew];
}
