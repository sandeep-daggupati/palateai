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

type DishRow = {
  dish_name: string;
  dish_key: string;
  source_upload_id: string;
  identity_tag: Database['public']['Enums']['dish_identity'] | null;
  rating: number | null;
  eaten_at: string | null;
  created_at: string;
  restaurant_id: string | null;
};

type RestaurantRow = {
  id: string;
  name: string;
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

function betweenDaysAgo(value: string | null | undefined, now: Date, minDaysAgo: number, maxDaysAgo: number): boolean {
  const stamp = parseTime(value);
  if (!stamp) return false;
  const age = now.getTime() - stamp;
  const min = minDaysAgo * 24 * 60 * 60 * 1000;
  const max = maxDaysAgo * 24 * 60 * 60 * 1000;
  return age >= min && age <= max;
}

function dishKey(name: string): string {
  return name.trim().toLowerCase();
}

function shortDishName(value: string): string {
  return value.length > 28 ? `${value.slice(0, 28)}...` : value;
}

function placeholderCards(): HighlightCard[] {
  return [
    {
      key: 'standout',
      title: 'Standout this week',
      body: 'Log a hangout to unlock highlights.',
      hint: 'Start with your first recap',
      href: '/add',
      image_label: 'S',
    },
    {
      key: 'repeat',
      title: 'On repeat',
      body: 'Your repeats will show up here.',
      hint: 'Patterns update as you log',
      href: '/dishes',
      image_label: 'R',
    },
    {
      key: 'memory',
      title: 'Still thinking about...',
      body: 'Memories will show up here.',
      hint: 'Keep logging hangouts',
      href: '/hangouts',
      image_label: 'M',
    },
  ];
}

export async function getHighlights(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<HighlightCard[]> {
  const now = new Date();

  const { data: dishRowsRaw } = await supabase
    .from('dish_entries')
    .select('dish_name,dish_key,source_upload_id,identity_tag,rating,eaten_at,created_at,restaurant_id')
    .eq('user_id', userId)
    .limit(1500);

  const rows = (dishRowsRaw ?? []) as DishRow[];
  if (rows.length === 0) return placeholderCards();

  const restaurantIds = Array.from(new Set(rows.map((row) => row.restaurant_id).filter((id): id is string => Boolean(id))));
  const restaurantLookup = new Map<string, string>();
  if (restaurantIds.length > 0) {
    const { data: restaurantRows } = await supabase.from('restaurants').select('id,name').in('id', restaurantIds);
    for (const row of (restaurantRows ?? []) as RestaurantRow[]) {
      restaurantLookup.set(row.id, row.name);
    }
  }

  const rows7 = rows.filter((row) => withinDays(row.eaten_at ?? row.created_at, now, 7));

  let standout: HighlightCard | null = null;
  const bestRated = [...rows7]
    .filter((row) => typeof row.rating === 'number')
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

  if (bestRated) {
    standout = {
      key: 'standout',
      title: 'Standout this week',
      body: shortDishName(bestRated.dish_name),
      hint: `Rated ${bestRated.rating?.toFixed(1) ?? '4.0'}`,
      href: `/uploads/${bestRated.source_upload_id}`,
      image_label: bestRated.dish_name.slice(0, 1).toUpperCase(),
    };
  } else {
    const goTo7 = rows7.filter((row) => row.identity_tag === 'go_to');
    const source = goTo7.length > 0 ? goTo7 : rows7;
    if (source.length > 0) {
      const counts = new Map<string, { count: number; row: DishRow }>();
      for (const row of source) {
        const key = dishKey(row.dish_name);
        const current = counts.get(key);
        if (!current) counts.set(key, { count: 1, row });
        else counts.set(key, { count: current.count + 1, row: current.row });
      }
      const top = Array.from(counts.values()).sort((a, b) => b.count - a.count)[0];
      standout = {
        key: 'standout',
        title: 'Standout this week',
        body: shortDishName(top.row.dish_name),
        hint: `${top.count}x this week`,
        href: `/uploads/${top.row.source_upload_id}`,
        image_label: top.row.dish_name.slice(0, 1).toUpperCase(),
      };
    }
  }

  let repeat: HighlightCard | null = null;
  if (rows7.length > 0) {
    const counts = new Map<string, { count: number; row: DishRow }>();
    for (const row of rows7) {
      const key = dishKey(row.dish_name);
      const current = counts.get(key);
      if (!current) counts.set(key, { count: 1, row });
      else counts.set(key, { count: current.count + 1, row: current.row });
    }

    const top = Array.from(counts.values()).sort((a, b) => b.count - a.count)[0];
    const query = encodeURIComponent(top.row.dish_name);

    repeat = {
      key: 'repeat',
      title: 'On repeat',
      body: `${shortDishName(top.row.dish_name)} - ${top.count}x this week`,
      hint: 'Open dishes for the full pattern',
      href: `/dishes?query=${query}`,
      image_label: top.row.dish_name.slice(0, 1).toUpperCase(),
    };

    if (top.count < 2) {
      const byRestaurant = new Map<string, number>();
      for (const row of rows7) {
        if (!row.restaurant_id) continue;
        byRestaurant.set(row.restaurant_id, (byRestaurant.get(row.restaurant_id) ?? 0) + 1);
      }
      const topRestaurant = Array.from(byRestaurant.entries()).sort((a, b) => b[1] - a[1])[0];
      if (topRestaurant) {
        const restaurantName = restaurantLookup.get(topRestaurant[0]) ?? 'Your favorite spot';
        repeat = {
          key: 'repeat',
          title: 'On repeat',
          body: `${restaurantName} - ${topRestaurant[1]}x this week`,
          hint: 'Open hangouts for details',
          href: `/hangouts?restaurant_id=${topRestaurant[0]}`,
          image_label: restaurantName.slice(0, 1).toUpperCase(),
        };
      }
    }
  }

  let memory: HighlightCard | null = null;
  const throwbacks = rows
    .filter((row) => betweenDaysAgo(row.eaten_at ?? row.created_at, now, 45, 90))
    .filter((row) => row.identity_tag === 'go_to' || (row.rating ?? 0) >= 4)
    .sort((a, b) => {
      const target = 60 * 24 * 60 * 60 * 1000;
      const aDelta = Math.abs(now.getTime() - parseTime(a.eaten_at ?? a.created_at) - target);
      const bDelta = Math.abs(now.getTime() - parseTime(b.eaten_at ?? b.created_at) - target);
      return aDelta - bDelta;
    });

  if (throwbacks.length > 0) {
    const pick = throwbacks[0];
    memory = {
      key: 'memory',
      title: 'Still thinking about...',
      body: shortDishName(pick.dish_name),
      hint: '~2 months ago',
      href: `/uploads/${pick.source_upload_id}`,
      image_label: pick.dish_name.slice(0, 1).toUpperCase(),
    };
  }

  const defaults = placeholderCards();
  return [standout ?? defaults[0], repeat ?? defaults[1], memory ?? defaults[2]];
}
