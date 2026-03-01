import { Database } from '@/lib/supabase/types';
import { SupabaseClient } from '@supabase/supabase-js';

export type HangoutChip = {
  restaurant_id: string;
  label: string;
  count: number;
  is_new: boolean;
  href: string;
};

type UploadRow = {
  id: string;
  owner_user_id: string;
  restaurant_id: string | null;
  occurred_at: string | null;
  created_at: string;
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

export async function getHangoutChips(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ chips: HangoutChip[]; hasHangouts: boolean }> {
  const now = new Date();

  const { data: participantRows } = await supabase
    .from('hangout_participants')
    .select('hangout_id')
    .eq('user_id', userId)
    .limit(300);

  const sharedIds = Array.from(new Set((participantRows ?? []).map((row) => row.hangout_id)));

  const { data: ownRowsRaw } = await supabase
    .from('hangouts')
    .select('id,owner_user_id,restaurant_id,occurred_at,created_at')
    .eq('owner_user_id', userId)
    .limit(1000);

  let sharedRows: UploadRow[] = [];
  if (sharedIds.length > 0) {
    const { data: sharedRowsRaw } = await supabase
      .from('hangouts')
      .select('id,owner_user_id,restaurant_id,occurred_at,created_at')
      .in('id', sharedIds)
      .limit(1000);

    sharedRows = (sharedRowsRaw ?? []) as UploadRow[];
  }

  const rows = [...((ownRowsRaw ?? []) as UploadRow[]), ...sharedRows].filter(
    (row, index, all) => all.findIndex((entry) => entry.id === row.id) === index,
  );

  if (rows.length === 0) return { chips: [], hasHangouts: false };

  const restaurantIds = Array.from(new Set(rows.map((row) => row.restaurant_id).filter((id): id is string => Boolean(id))));
  const restaurantLookup = new Map<string, string>();
  if (restaurantIds.length > 0) {
    const { data: restaurantRows } = await supabase.from('restaurants').select('id,name').in('id', restaurantIds);
    for (const row of (restaurantRows ?? []) as RestaurantRow[]) {
      restaurantLookup.set(row.id, row.name);
    }
  }

  const rows30 = rows.filter((row) => withinDays(row.occurred_at ?? row.created_at, now, 30) && Boolean(row.restaurant_id));

  const priorRestaurantIds = new Set(
    rows
      .filter((row) => !withinDays(row.occurred_at ?? row.created_at, now, 30))
      .map((row) => row.restaurant_id)
      .filter((id): id is string => Boolean(id)),
  );

  const counts = new Map<string, number>();
  for (const row of rows30) {
    if (!row.restaurant_id) continue;
    counts.set(row.restaurant_id, (counts.get(row.restaurant_id) ?? 0) + 1);
  }

  const chips: HangoutChip[] = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([restaurantId, count]) => {
      const name = restaurantLookup.get(restaurantId) ?? 'Unknown place';
      const isNew = !priorRestaurantIds.has(restaurantId);
      const label = isNew ? `New: ${name}` : `${name} - ${count}x`;
      return {
        restaurant_id: restaurantId,
        label,
        count,
        is_new: isNew,
        href: `/hangouts?restaurant_id=${restaurantId}`,
      };
    });

  return { chips, hasHangouts: true };
}
