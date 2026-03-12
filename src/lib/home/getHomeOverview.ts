import { Database } from '@/lib/supabase/types';
import { SupabaseClient } from '@supabase/supabase-js';

export type StreakSummary = {
  days: number;
  subtext: string | null;
};

export type FlavorBar = {
  label: string;
  value: number;
};

export type FlavorFingerprint = {
  bars: FlavorBar[];
  tagline: string;
};

export type FoodCrewRow = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  hangout_count: number;
  introduced_spots: number;
  average_rating: number | null;
};

export type RecentHangoutRow = {
  id: string;
  restaurant_name: string;
  date_label: string;
  people_count: number;
  dish_count: number;
  average_rating: number | null;
  avatars: Array<{ user_id: string; name: string; avatar_url: string | null }>;
};

type ReceiptUploadMini = {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  visited_at: string | null;
  created_at: string;
  status: string;
};

type VisitParticipantMini = {
  visit_id: string;
  user_id: string;
  status: Database['public']['Tables']['visit_participants']['Row']['status'];
};

type ProfileMini = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

type DishEntryMini = {
  id: string;
  source_upload_id: string;
};

type DishParticipantRatingMini = {
  dish_entry_id: string;
  user_id: string;
  rating: number | null;
};

type PersonalFoodMini = {
  dish_key: string | null;
  created_at: string;
};

type DishCatalogMini = {
  dish_key: string;
  cuisine: string | null;
  flavor_tags: string[] | null;
};

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function fallbackName(profile: ProfileMini | null | undefined): string {
  const display = profile?.display_name?.trim();
  if (display) return display;
  const emailPrefix = profile?.email?.split('@')[0]?.trim();
  if (emailPrefix) return emailPrefix;
  return 'Friend';
}

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayDiffFromToday(key: string, now: Date): number {
  const [year, month, day] = key.split('-').map((chunk) => Number(chunk));
  const date = new Date(year, (month || 1) - 1, day || 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deltaMs = today.getTime() - date.getTime();
  return Math.floor(deltaMs / (24 * 60 * 60 * 1000));
}

function computeStreak(dayKeys: string[]): StreakSummary {
  if (dayKeys.length === 0) {
    return { days: 0, subtext: null };
  }

  const now = new Date();
  const keySet = new Set(dayKeys);
  const today = toDateKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = toDateKey(yesterdayDate);

  let anchor = today;
  let subtext: string | null = 'Logged today.';

  if (!keySet.has(today)) {
    if (keySet.has(yesterday)) {
      anchor = yesterday;
      subtext = 'Last logged yesterday.';
    } else {
      const sorted = [...keySet].sort((a, b) => b.localeCompare(a));
      anchor = sorted[0];
      const daysAgo = dayDiffFromToday(anchor, now);
      subtext = daysAgo <= 1 ? 'Last logged yesterday.' : `Last logged ${daysAgo} days ago.`;
    }
  }

  let streak = 0;
  const cursor = new Date(anchor);
  while (keySet.has(toDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { days: streak, subtext };
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function flavorPersona(primaryFlavor: string | null): string {
  if (!primaryFlavor) return 'Taste explorer';
  if (primaryFlavor.includes('comfort')) return 'Comfort seeker';
  if (primaryFlavor.includes('spicy') || primaryFlavor.includes('heat')) return 'Heat seeker';
  if (primaryFlavor.includes('sweet')) return 'Sweet leaning';
  if (primaryFlavor.includes('savory') || primaryFlavor.includes('umami')) return 'Savory seeker';
  if (primaryFlavor.includes('fresh') || primaryFlavor.includes('herb')) return 'Fresh palate';
  return 'Taste explorer';
}

function formatDateLabel(value: string | null, fallback: string): string {
  const stamp = parseTime(value ?? fallback);
  if (!stamp) return 'Unknown date';
  return new Date(stamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

async function loadHangoutUniverse(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{
  visits: ReceiptUploadMini[];
  participants: VisitParticipantMini[];
  profilesById: Record<string, ProfileMini>;
  restaurantsById: Record<string, string>;
  dishByVisit: Record<string, string[]>;
  ratingsByDish: DishParticipantRatingMini[];
}> {
  const [{ data: ownVisits }, { data: userParticipantRows }] = await Promise.all([
    supabase
      .from('receipt_uploads')
      .select('id,user_id,restaurant_id,visited_at,created_at,status')
      .eq('user_id', userId)
      .neq('status', 'failed')
      .order('visited_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('visit_participants')
      .select('visit_id,user_id,status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(400),
  ]);

  const sharedVisitIds = Array.from(new Set((userParticipantRows ?? []).map((row) => row.visit_id)));
  let sharedVisits: ReceiptUploadMini[] = [];
  if (sharedVisitIds.length > 0) {
    const { data } = await supabase
      .from('receipt_uploads')
      .select('id,user_id,restaurant_id,visited_at,created_at,status')
      .in('id', sharedVisitIds)
      .neq('status', 'failed')
      .order('visited_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(300);
    sharedVisits = (data ?? []) as ReceiptUploadMini[];
  }

  const visits = [...((ownVisits ?? []) as ReceiptUploadMini[]), ...sharedVisits]
    .filter((row, idx, all) => all.findIndex((entry) => entry.id === row.id) === idx)
    .sort((a, b) => parseTime(b.visited_at ?? b.created_at) - parseTime(a.visited_at ?? a.created_at));

  if (visits.length === 0) {
    return {
      visits: [],
      participants: [],
      profilesById: {},
      restaurantsById: {},
      dishByVisit: {},
      ratingsByDish: [],
    };
  }

  const visitIds = visits.map((visit) => visit.id);
  const restaurantIds = Array.from(new Set(visits.map((visit) => visit.restaurant_id).filter((id): id is string => Boolean(id))));

  const [participantsResult, restaurantsResult, dishesResult] = await Promise.all([
    supabase
      .from('visit_participants')
      .select('visit_id,user_id,status')
      .in('visit_id', visitIds)
      .eq('status', 'active'),
    restaurantIds.length > 0
      ? supabase.from('restaurants').select('id,name').in('id', restaurantIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    supabase
      .from('dish_entries')
      .select('id,source_upload_id')
      .in('source_upload_id', visitIds),
  ]);

  const participants = (participantsResult.data ?? []) as VisitParticipantMini[];
  const dishes = (dishesResult.data ?? []) as DishEntryMini[];

  const profileIds = Array.from(
    new Set(
      [...participants.map((row) => row.user_id), ...visits.map((row) => row.user_id)].filter((id): id is string => Boolean(id)),
    ),
  );

  let profilesById: Record<string, ProfileMini> = {};
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id,display_name,avatar_url,email').in('id', profileIds);
    profilesById = ((profiles ?? []) as ProfileMini[]).reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {} as Record<string, ProfileMini>);
  }

  const restaurantsById = ((restaurantsResult.data ?? []) as Array<{ id: string; name: string }>).reduce(
    (acc, row) => {
      acc[row.id] = row.name;
      return acc;
    },
    {} as Record<string, string>,
  );

  const dishByVisit = dishes.reduce((acc, row) => {
    if (!acc[row.source_upload_id]) acc[row.source_upload_id] = [];
    acc[row.source_upload_id].push(row.id);
    return acc;
  }, {} as Record<string, string[]>);

  const dishIds = dishes.map((row) => row.id);
  let ratingsByDish: DishParticipantRatingMini[] = [];
  if (dishIds.length > 0) {
    const { data: ratings } = await supabase
      .from('dish_entry_participants')
      .select('dish_entry_id,user_id,rating')
      .in('dish_entry_id', dishIds)
      .not('rating', 'is', null)
      .limit(4000);
    ratingsByDish = (ratings ?? []) as DishParticipantRatingMini[];
  }

  return {
    visits,
    participants,
    profilesById,
    restaurantsById,
    dishByVisit,
    ratingsByDish,
  };
}

export async function getHomeOverview(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{
  streak: StreakSummary;
  fingerprint: FlavorFingerprint;
  crew: FoodCrewRow[];
  recentHangouts: RecentHangoutRow[];
}> {
  const [{ data: personalRows }, hangoutUniverse] = await Promise.all([
    supabase
      .from('personal_food_entries')
      .select('dish_key,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(600),
    loadHangoutUniverse(supabase, userId),
  ]);

  const personal = (personalRows ?? []) as PersonalFoodMini[];
  const dayKeys = Array.from(new Set(personal.map((row) => toDateKey(new Date(row.created_at)))));
  const streak = computeStreak(dayKeys);

  const dishKeys = Array.from(new Set(personal.map((row) => normalizeToken(row.dish_key)).filter(Boolean)));
  let catalogByKey: Record<string, DishCatalogMini> = {};
  if (dishKeys.length > 0) {
    const { data: catalogRows } = await supabase.from('dish_catalog').select('dish_key,cuisine,flavor_tags').in('dish_key', dishKeys);
    catalogByKey = ((catalogRows ?? []) as DishCatalogMini[]).reduce((acc, row) => {
      acc[normalizeToken(row.dish_key)] = row;
      return acc;
    }, {} as Record<string, DishCatalogMini>);
  }

  const flavorCounts = new Map<string, number>();
  const cuisineCounts = new Map<string, number>();

  for (const row of personal) {
    const key = normalizeToken(row.dish_key);
    if (!key) continue;
    const catalog = catalogByKey[key];

    const tags = Array.isArray(catalog?.flavor_tags)
      ? catalog.flavor_tags.map((tag) => normalizeToken(tag)).filter(Boolean)
      : [];

    tags.forEach((tag) => flavorCounts.set(tag, (flavorCounts.get(tag) ?? 0) + 1));

    const cuisine = normalizeToken(catalog?.cuisine);
    if (cuisine) cuisineCounts.set(cuisine, (cuisineCounts.get(cuisine) ?? 0) + 1);
  }

  const topFlavors = Array.from(flavorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxFlavorCount = topFlavors[0]?.[1] ?? 1;
  const bars: FlavorBar[] = topFlavors.map(([label, count]) => ({
    label: titleCase(label),
    value: Math.round((count / maxFlavorCount) * 100),
  }));

  const primaryFlavor = topFlavors[0]?.[0] ?? null;
  const primaryCuisine = Array.from(cuisineCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const fingerprint: FlavorFingerprint = {
    bars: bars.length > 0 ? bars : [{ label: 'Savory', value: 52 }, { label: 'Fresh', value: 34 }, { label: 'Spicy', value: 21 }],
    tagline: [
      primaryFlavor ? `${titleCase(primaryFlavor)}-heavy` : 'Savory-heavy',
      primaryCuisine ? `${titleCase(primaryCuisine)}-leaning` : 'Italian-leaning',
      flavorPersona(primaryFlavor),
    ].join(' · '),
  };

  const { visits, participants, profilesById, restaurantsById, dishByVisit, ratingsByDish } = hangoutUniverse;

  const ratingsByVisit = ratingsByDish.reduce((acc, row) => {
    const visitId = Object.keys(dishByVisit).find((key) => dishByVisit[key]?.includes(row.dish_entry_id));
    if (!visitId || typeof row.rating !== 'number') return acc;
    if (!acc[visitId]) acc[visitId] = [];
    acc[visitId].push(row.rating);
    return acc;
  }, {} as Record<string, number[]>);

  const recentHangouts: RecentHangoutRow[] = visits.slice(0, 5).map((visit) => {
    const visitParticipants = participants.filter((row) => row.visit_id === visit.id);
    const avatars = visitParticipants.slice(0, 4).map((row) => {
      const profile = profilesById[row.user_id];
      return {
        user_id: row.user_id,
        name: fallbackName(profile),
        avatar_url: profile?.avatar_url ?? null,
      };
    });

    const ratingValues = ratingsByVisit[visit.id] ?? [];

    return {
      id: visit.id,
      restaurant_name: visit.restaurant_id ? restaurantsById[visit.restaurant_id] ?? 'Unknown place' : 'Unknown place',
      date_label: formatDateLabel(visit.visited_at, visit.created_at),
      people_count: Math.max(visitParticipants.length, 1),
      dish_count: dishByVisit[visit.id]?.length ?? 0,
      average_rating:
        ratingValues.length > 0
          ? Number((ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(1))
          : null,
      avatars,
    };
  });

  const activeSharedVisits = visits.filter((visit) => {
    const visitParticipants = participants.filter((row) => row.visit_id === visit.id);
    return visitParticipants.some((row) => row.user_id === userId) && visitParticipants.some((row) => row.user_id !== userId);
  });

  const hangoutIdsByFriend = new Map<string, Set<string>>();
  const introducedSpotsByFriend = new Map<string, Set<string>>();

  for (const visit of activeSharedVisits) {
    const visitParticipants = participants.filter((row) => row.visit_id === visit.id);
    for (const row of visitParticipants) {
      if (row.user_id === userId) continue;
      if (!hangoutIdsByFriend.has(row.user_id)) hangoutIdsByFriend.set(row.user_id, new Set());
      hangoutIdsByFriend.get(row.user_id)?.add(visit.id);

      if (visit.user_id === row.user_id && visit.restaurant_id) {
        if (!introducedSpotsByFriend.has(row.user_id)) introducedSpotsByFriend.set(row.user_id, new Set());
        introducedSpotsByFriend.get(row.user_id)?.add(visit.restaurant_id);
      }
    }
  }

  const ratingsByFriend = ratingsByDish.reduce((acc, row) => {
    if (row.user_id === userId || typeof row.rating !== 'number') return acc;
    if (!acc[row.user_id]) acc[row.user_id] = [];
    acc[row.user_id].push(row.rating);
    return acc;
  }, {} as Record<string, number[]>);

  const crew: FoodCrewRow[] = Array.from(hangoutIdsByFriend.entries())
    .map(([friendId, friendVisitIds]) => {
      const profile = profilesById[friendId];
      const ratings = ratingsByFriend[friendId] ?? [];
      return {
        user_id: friendId,
        name: fallbackName(profile),
        avatar_url: profile?.avatar_url ?? null,
        hangout_count: friendVisitIds.size,
        introduced_spots: introducedSpotsByFriend.get(friendId)?.size ?? 0,
        average_rating: ratings.length > 0 ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1)) : null,
      };
    })
    .sort((a, b) => b.hangout_count - a.hangout_count)
    .slice(0, 5);

  return {
    streak,
    fingerprint,
    crew,
    recentHangouts,
  };
}
