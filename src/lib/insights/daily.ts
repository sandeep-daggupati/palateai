import { Json } from '@/lib/supabase/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type InsightCategory = 'palate' | 'explore' | 'spend' | 'wildcard';
type EvidenceType = 'dish' | 'restaurant' | 'hangout' | 'summary';

type CrewPreview = Array<{ display_name: string; avatar_url: string | null }>;

type InsightRecord = {
  id: string;
  user_id: string;
  insight_text: string;
  category: InsightCategory;
  metrics_snapshot: Json;
  evidence_type: EvidenceType;
  evidence: Json;
  generated_at: string;
  expires_at: string;
};

type DishRow = {
  dish_name: string;
  restaurant_id: string | null;
  source_upload_id: string;
  eaten_at: string | null;
  created_at: string;
  identity_tag: string | null;
  price_original: number | null;
  quantity: number | null;
  rating: number | null;
};

type HangoutRow = {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  visited_at: string | null;
  created_at: string;
  status: string;
};

type RestaurantRow = {
  id: string;
  name: string;
};

type Candidate = {
  category: 'palate' | 'explore' | 'spend' | 'wildcard';
  evidence_type: EvidenceType;
  evidence: Record<string, unknown>;
  fact: string;
  strength_score: number;
};

type CategoryCandidate = {
  primary: Candidate | null;
  backup: Candidate | null;
  available: boolean;
};

type DataBundle = {
  dishesAll: DishRow[];
  hangoutsAll: HangoutRow[];
  restaurantsById: Map<string, string>;
  now: Date;
};

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function stableDishKey(value: string): string {
  return value.trim().toLowerCase();
}

function emailPrefix(value: string | null | undefined): string | null {
  if (!value) return null;
  const prefix = value.split('@')[0]?.trim();
  return prefix || null;
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
  const ageMs = now.getTime() - stamp;
  const minMs = minDaysAgo * 24 * 60 * 60 * 1000;
  const maxMs = maxDaysAgo * 24 * 60 * 60 * 1000;
  return ageMs >= minMs && ageMs <= maxMs;
}

function getNYWeekday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/New_York',
  }).format(now);
}

function dayCategory(now: Date): InsightCategory {
  const weekday = getNYWeekday(now);
  if (weekday === 'Mon' || weekday === 'Thu') return 'palate';
  if (weekday === 'Tue' || weekday === 'Fri') return 'explore';
  if (weekday === 'Wed' || weekday === 'Sat') return 'spend';
  return 'wildcard';
}

async function crewPreviewForHangout(
  service: ReturnType<typeof getServiceSupabaseClient>,
  hangoutId: string,
  hostUserId: string | null,
): Promise<CrewPreview> {
  const { data: participantRows } = await service
    .from('visit_participants')
    .select('user_id,status,created_at')
    .eq('visit_id', hangoutId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(8);

  const participantIds = (participantRows ?? [])
    .map((row) => row.user_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const allUserIds = Array.from(new Set([...(hostUserId ? [hostUserId] : []), ...participantIds]));
  if (allUserIds.length === 0) return [];

  const { data: profileRows } = await service
    .from('profiles')
    .select('id,display_name,avatar_url,email')
    .in('id', allUserIds);

  const profileLookup = new Map((profileRows ?? []).map((row) => [row.id, row]));

  return allUserIds.slice(0, 5).map((id) => {
    const profile = profileLookup.get(id);
    const name = profile?.display_name?.trim() || emailPrefix(profile?.email) || 'Buddy';
    return {
      display_name: name,
      avatar_url: profile?.avatar_url ?? null,
    };
  });
}

async function loadData(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
  now: Date,
): Promise<DataBundle> {
  const { data: dishesRaw } = await service
    .from('dish_entries')
    .select('dish_name,restaurant_id,source_upload_id,eaten_at,created_at,identity_tag,price_original,quantity,rating')
    .eq('user_id', userId)
    .limit(10000);

  const dishesAll = (dishesRaw ?? []) as DishRow[];

  const { data: hangoutsRaw } = await service
    .from('receipt_uploads')
    .select('id,user_id,restaurant_id,visited_at,created_at,status')
    .eq('user_id', userId)
    .neq('status', 'failed')
    .limit(5000);

  const hangoutsAll = (hangoutsRaw ?? []) as HangoutRow[];

  const restaurantIds = Array.from(
    new Set([...dishesAll.map((row) => row.restaurant_id), ...hangoutsAll.map((row) => row.restaurant_id)].filter((id): id is string => Boolean(id))),
  );

  const restaurantsById = new Map<string, string>();
  if (restaurantIds.length > 0) {
    const { data: restaurantRows } = await service.from('restaurants').select('id,name').in('id', restaurantIds);
    for (const row of (restaurantRows ?? []) as RestaurantRow[]) {
      restaurantsById.set(row.id, row.name);
    }
  }

  return {
    dishesAll,
    hangoutsAll,
    restaurantsById,
    now,
  };
}

function computeMetricsSnapshot(bundle: DataBundle): Record<string, unknown> {
  const dishes30 = bundle.dishesAll.filter((row) => withinDays(row.eaten_at ?? row.created_at, bundle.now, 30));
  const hangouts30 = bundle.hangoutsAll.filter((row) => withinDays(row.visited_at ?? row.created_at, bundle.now, 30));

  const dishCounts = new Map<string, number>();
  for (const row of dishes30) {
    const key = stableDishKey(row.dish_name);
    dishCounts.set(key, (dishCounts.get(key) ?? 0) + 1);
  }

  const topDishEntry = Array.from(dishCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const topDishName = topDishEntry
    ? dishes30.find((row) => stableDishKey(row.dish_name) === topDishEntry[0])?.dish_name ?? topDishEntry[0]
    : null;

  const restaurantCounts = new Map<string, number>();
  for (const row of hangouts30) {
    if (!row.restaurant_id) continue;
    restaurantCounts.set(row.restaurant_id, (restaurantCounts.get(row.restaurant_id) ?? 0) + 1);
  }

  const topRestaurantEntry = Array.from(restaurantCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const topRestaurantName = topRestaurantEntry ? bundle.restaurantsById.get(topRestaurantEntry[0]) ?? 'Unknown restaurant' : null;

  const priorRestaurantIds = new Set(
    bundle.hangoutsAll
      .filter((row) => !withinDays(row.visited_at ?? row.created_at, bundle.now, 30))
      .map((row) => row.restaurant_id)
      .filter((id): id is string => Boolean(id)),
  );

  const newPlacesCount = new Set(
    hangouts30
      .map((row) => row.restaurant_id)
      .filter((id): id is string => Boolean(id))
      .filter((id) => !priorRestaurantIds.has(id)),
  ).size;

  const goToCount = dishes30.filter((row) => row.identity_tag === 'go_to').length;
  const goToRatio = dishes30.length > 0 ? Number((goToCount / dishes30.length).toFixed(2)) : 0;

  const dishes7Priced = bundle.dishesAll.filter(
    (row) => withinDays(row.eaten_at ?? row.created_at, bundle.now, 7) && typeof row.price_original === 'number',
  );
  const spendThisWeek = Number(
    dishes7Priced
      .reduce((sum, row) => sum + (row.price_original ?? 0) * Math.max(1, row.quantity ?? 1), 0)
      .toFixed(2),
  );

  const snapshot: Record<string, unknown> = {
    hangouts_this_month: hangouts30.length,
    top_dish: topDishName,
    top_dish_count: topDishEntry?.[1] ?? 0,
    top_restaurant: topRestaurantName,
    top_restaurant_count: topRestaurantEntry?.[1] ?? 0,
    new_places_this_month: newPlacesCount,
    go_to_ratio: goToRatio,
  };

  if (dishes7Priced.length >= 2) {
    snapshot.spend_this_week = spendThisWeek;
  }

  return snapshot;
}

async function buildPalateCandidate(
  service: ReturnType<typeof getServiceSupabaseClient>,
  bundle: DataBundle,
): Promise<CategoryCandidate> {
  const dishes30 = bundle.dishesAll.filter((row) => withinDays(row.eaten_at ?? row.created_at, bundle.now, 30));
  const source = dishes30.filter((row) => row.identity_tag === 'go_to');
  const dishSource = source.length > 0 ? source : dishes30;

  let primary: Candidate | null = null;
  let backup: Candidate | null = null;

  if (dishSource.length > 0) {
    const counts = new Map<string, { count: number; lastAt: number; lastHangoutId: string; restaurantId: string | null }>();
    for (const row of dishSource) {
      const key = stableDishKey(row.dish_name);
      const stamp = parseTime(row.eaten_at ?? row.created_at);
      const current = counts.get(key);
      if (!current) {
        counts.set(key, { count: 1, lastAt: stamp, lastHangoutId: row.source_upload_id, restaurantId: row.restaurant_id });
      } else {
        const newer = stamp > current.lastAt;
        counts.set(key, {
          count: current.count + 1,
          lastAt: newer ? stamp : current.lastAt,
          lastHangoutId: newer ? row.source_upload_id : current.lastHangoutId,
          restaurantId: newer ? row.restaurant_id : current.restaurantId,
        });
      }
    }

    const top = Array.from(counts.entries()).sort((a, b) => (b[1].count - a[1].count) || (b[1].lastAt - a[1].lastAt))[0];
    if (top) {
      const dishName = dishSource.find((row) => stableDishKey(row.dish_name) === top[0])?.dish_name ?? top[0];
      const hangout = bundle.hangoutsAll.find((row) => row.id === top[1].lastHangoutId);
      const restaurantName = top[1].restaurantId ? bundle.restaurantsById.get(top[1].restaurantId) ?? 'Unknown restaurant' : 'Unknown restaurant';
      const crew = await crewPreviewForHangout(service, top[1].lastHangoutId, hangout?.user_id ?? null);

      primary = {
        category: 'palate',
        evidence_type: 'dish',
        strength_score: top[1].count + (source.length > 0 ? 0.75 : 0),
        fact: `${dishName} appears ${top[1].count} times in your last 30 days and is currently on repeat.`,
        evidence: {
          dish_name: dishName,
          count: top[1].count,
          frequency: top[1].count,
          window_days: 30,
          last_hangout_id: top[1].lastHangoutId,
          restaurant_name: restaurantName,
          crew_preview: crew,
        },
      };
    }
  }

  const hangouts30 = bundle.hangoutsAll.filter((row) => withinDays(row.visited_at ?? row.created_at, bundle.now, 30));
  if (hangouts30.length > 0) {
    const restaurantCounts = new Map<string, { count: number; lastAt: number; lastHangoutId: string }>();
    for (const row of hangouts30) {
      if (!row.restaurant_id) continue;
      const stamp = parseTime(row.visited_at ?? row.created_at);
      const current = restaurantCounts.get(row.restaurant_id);
      if (!current) {
        restaurantCounts.set(row.restaurant_id, { count: 1, lastAt: stamp, lastHangoutId: row.id });
      } else {
        const newer = stamp > current.lastAt;
        restaurantCounts.set(row.restaurant_id, {
          count: current.count + 1,
          lastAt: newer ? stamp : current.lastAt,
          lastHangoutId: newer ? row.id : current.lastHangoutId,
        });
      }
    }

    const topRestaurant = Array.from(restaurantCounts.entries()).sort((a, b) => (b[1].count - a[1].count) || (b[1].lastAt - a[1].lastAt))[0];
    if (topRestaurant) {
      const restaurantName = bundle.restaurantsById.get(topRestaurant[0]) ?? 'Unknown restaurant';
      const hangout = bundle.hangoutsAll.find((row) => row.id === topRestaurant[1].lastHangoutId);
      const crew = await crewPreviewForHangout(service, topRestaurant[1].lastHangoutId, hangout?.user_id ?? null);

      const restaurantCandidate: Candidate = {
        category: 'palate',
        evidence_type: 'restaurant',
        strength_score: topRestaurant[1].count,
        fact: `${restaurantName} shows up most often in your recent hangouts (${topRestaurant[1].count} times).`,
        evidence: {
          restaurant_name: restaurantName,
          hangout_count: topRestaurant[1].count,
          last_hangout_id: topRestaurant[1].lastHangoutId,
          last_hangout_date: formatDate(hangout?.visited_at ?? hangout?.created_at),
          crew_preview: crew,
        },
      };

      if (!primary) {
        primary = restaurantCandidate;
      } else {
        backup = restaurantCandidate;
      }
    }
  }

  return {
    primary,
    backup,
    available: Boolean(primary),
  };
}

function buildExploreCandidate(bundle: DataBundle): CategoryCandidate {
  const hangouts30 = bundle.hangoutsAll.filter((row) => withinDays(row.visited_at ?? row.created_at, bundle.now, 30));

  const priorRestaurantIds = new Set(
    bundle.hangoutsAll
      .filter((row) => !withinDays(row.visited_at ?? row.created_at, bundle.now, 30))
      .map((row) => row.restaurant_id)
      .filter((id): id is string => Boolean(id)),
  );

  const newPlaceRows = hangouts30.filter((row) => Boolean(row.restaurant_id) && !priorRestaurantIds.has(row.restaurant_id as string));
  const newestPlace = [...newPlaceRows].sort((a, b) => parseTime(b.visited_at ?? b.created_at) - parseTime(a.visited_at ?? a.created_at))[0];

  let primary: Candidate | null = null;
  let backup: Candidate | null = null;

  if (newPlaceRows.length > 0) {
    const newestName = newestPlace?.restaurant_id ? bundle.restaurantsById.get(newestPlace.restaurant_id) ?? 'Unknown restaurant' : 'Unknown restaurant';
    primary = {
      category: 'explore',
      evidence_type: 'summary',
      strength_score: new Set(newPlaceRows.map((row) => row.restaurant_id)).size,
      fact: `You logged ${new Set(newPlaceRows.map((row) => row.restaurant_id)).size} new place${newPlaceRows.length === 1 ? '' : 's'} this month.`,
      evidence: {
        metrics: [
          { label: 'New places this month', value: new Set(newPlaceRows.map((row) => row.restaurant_id)).size },
          { label: 'Hangouts this month', value: hangouts30.length },
        ],
        new_places_this_month: new Set(newPlaceRows.map((row) => row.restaurant_id)).size,
        newest_place_name: newestName,
        last_hangout_id: newestPlace?.id ?? null,
      },
    };
  }

  const throwbackRows = bundle.dishesAll
    .filter((row) => betweenDaysAgo(row.eaten_at ?? row.created_at, bundle.now, 45, 90))
    .filter((row) => row.identity_tag === 'go_to' || (row.rating ?? 0) >= 4);

  const throwback = throwbackRows.sort((a, b) => parseTime(b.eaten_at ?? b.created_at) - parseTime(a.eaten_at ?? a.created_at))[0];
  if (throwback) {
    const restaurantName = throwback.restaurant_id ? bundle.restaurantsById.get(throwback.restaurant_id) ?? 'Unknown restaurant' : 'Unknown restaurant';
    const throwbackCandidate: Candidate = {
      category: 'explore',
      evidence_type: 'hangout',
      strength_score: (throwback.rating ?? 0) + (throwback.identity_tag === 'go_to' ? 1 : 0.5),
      fact: `${throwback.dish_name} stands out as a throwback from your earlier logs.`,
      evidence: {
        hangout_id: throwback.source_upload_id,
        hangout_date: formatDate(throwback.eaten_at ?? throwback.created_at),
        restaurant_name: restaurantName,
        top_dish: throwback.dish_name,
      },
    };

    if (!primary) {
      primary = throwbackCandidate;
    } else {
      backup = throwbackCandidate;
    }
  }

  return {
    primary,
    backup,
    available: Boolean(primary),
  };
}

function buildSpendCandidate(bundle: DataBundle): CategoryCandidate {
  const priced7 = bundle.dishesAll.filter(
    (row) => withinDays(row.eaten_at ?? row.created_at, bundle.now, 7) && typeof row.price_original === 'number',
  );

  const priced30 = bundle.dishesAll.filter(
    (row) => withinDays(row.eaten_at ?? row.created_at, bundle.now, 30) && typeof row.price_original === 'number',
  );

  const hasReliableSpend = priced7.length >= 2 || priced30.length >= 4;

  if (!hasReliableSpend) {
    return { primary: null, backup: null, available: false };
  }

  const weeklySpend = Number(
    priced7
      .reduce((sum, row) => sum + (row.price_original ?? 0) * Math.max(1, row.quantity ?? 1), 0)
      .toFixed(2),
  );

  const hangoutIds7 = new Set(priced7.map((row) => row.source_upload_id));

  const primary: Candidate = {
    category: 'spend',
    evidence_type: 'summary',
    strength_score: Math.max(1, weeklySpend / 20),
    fact: `Your logged spend in the last 7 days is ${weeklySpend.toFixed(2)} across ${hangoutIds7.size} hangouts.`,
    evidence: {
      metrics: [
        { label: 'Spend this week', value: weeklySpend },
        { label: 'Hangouts this week', value: hangoutIds7.size },
      ],
      spend_this_week: weeklySpend,
      hangouts_this_week: hangoutIds7.size,
    },
  };

  const cheapest = priced30
    .map((row) => ({ ...row, unit: (row.price_original ?? 0) / Math.max(1, row.quantity ?? 1) }))
    .sort((a, b) => a.unit - b.unit)[0];

  let backup: Candidate | null = null;
  if (cheapest) {
    const restaurantName = cheapest.restaurant_id ? bundle.restaurantsById.get(cheapest.restaurant_id) ?? 'Unknown restaurant' : 'Unknown restaurant';
    backup = {
      category: 'spend',
      evidence_type: 'dish',
      strength_score: Math.max(1, 10 - cheapest.unit),
      fact: `${cheapest.dish_name} looks like your best value lately at ${cheapest.unit.toFixed(2)} per serving.`,
      evidence: {
        dish_name: cheapest.dish_name,
        unit_price: Number(cheapest.unit.toFixed(2)),
        restaurant_name: restaurantName,
        last_hangout_id: cheapest.source_upload_id,
      },
    };
  }

  return {
    primary,
    backup,
    available: true,
  };
}

function chooseCategoryByRule(
  target: InsightCategory,
  palette: CategoryCandidate,
  explore: CategoryCandidate,
  spend: CategoryCandidate,
): Candidate {
  const palateCandidate = palette.primary ?? palette.backup;
  const exploreCandidate = explore.primary ?? explore.backup;
  const spendCandidate = spend.primary ?? spend.backup;

  const strongest = (items: Array<Candidate | null>): Candidate | null => {
    const filtered = items.filter((row): row is Candidate => Boolean(row));
    if (filtered.length === 0) return null;
    return filtered.sort((a, b) => b.strength_score - a.strength_score)[0];
  };

  if (target === 'palate') {
    return strongest([palateCandidate, exploreCandidate, spendCandidate]) ?? {
      category: 'palate',
      evidence_type: 'summary',
      fact: 'Your recent logs are still light, so this is a baseline snapshot for today.',
      strength_score: 0,
      evidence: { metrics: [{ label: 'Hangouts this month', value: 0 }] },
    };
  }

  if (target === 'explore') {
    if (explore.available && exploreCandidate) return exploreCandidate;
    if (palateCandidate) return palateCandidate;
    return strongest([spendCandidate, exploreCandidate, palateCandidate]) ?? {
      category: 'explore',
      evidence_type: 'summary',
      fact: 'Your recent logs are still light, so this is a baseline snapshot for today.',
      strength_score: 0,
      evidence: { metrics: [{ label: 'Hangouts this month', value: 0 }] },
    };
  }

  if (target === 'spend') {
    if (spend.available && spendCandidate) return spendCandidate;
    if (palateCandidate) return palateCandidate;
    if (exploreCandidate) return exploreCandidate;
    return {
      category: 'spend',
      evidence_type: 'summary',
      fact: 'Price data is limited right now, so this is a baseline snapshot for today.',
      strength_score: 0,
      evidence: { metrics: [{ label: 'Priced items this week', value: 0 }] },
    };
  }

  return strongest([palateCandidate, exploreCandidate]) ?? strongest([spendCandidate, palateCandidate, exploreCandidate]) ?? {
    category: 'wildcard',
    evidence_type: 'summary',
    fact: 'Your recent logs are still light, so this is a baseline snapshot for today.',
    strength_score: 0,
    evidence: { metrics: [{ label: 'Hangouts this month', value: 0 }] },
  };
}

async function phraseInsight(candidate: Candidate, metricsSnapshot: Record<string, unknown>): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return candidate.fact;

  const prompt = `Write exactly one sentence.
Tone: calm, observational.
No advice, no shaming, no invented facts.
Use only this JSON.
0 or 1 emoji max.

${JSON.stringify({ category: candidate.category, metrics_snapshot: metricsSnapshot, fact: candidate.fact })}`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      }),
    });

    if (!response.ok) return candidate.fact;

    const payload = (await response.json()) as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ text?: unknown }> }>;
    };

    const outputText = typeof payload.output_text === 'string' ? payload.output_text : null;
    const fromParts = payload.output?.flatMap((entry) => entry.content ?? []).find((part) => typeof part.text === 'string')?.text;
    const text = (outputText ?? (typeof fromParts === 'string' ? fromParts : null))?.trim();

    if (!text) return candidate.fact;
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.endsWith('.') ? oneLine : `${oneLine}.`;
  } catch {
    return candidate.fact;
  }
}

export async function getOrCreateDailyInsight(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
): Promise<InsightRecord> {
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: cached } = await service
    .from('daily_insights')
    .select('id,user_id,insight_text,category,metrics_snapshot,evidence_type,evidence,generated_at,expires_at')
    .eq('user_id', userId)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (cached) return cached as InsightRecord;

  const bundle = await loadData(service, userId, now);
  const metricsSnapshot = computeMetricsSnapshot(bundle);

  const palate = await buildPalateCandidate(service, bundle);
  const explore = buildExploreCandidate(bundle);
  const spend = buildSpendCandidate(bundle);

  const targetCategory = dayCategory(now);
  const selected = chooseCategoryByRule(targetCategory, palate, explore, spend);
  const text = await phraseInsight(selected, metricsSnapshot);

  const generatedAt = now;
  const expiresAt = new Date(generatedAt.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await service
    .from('daily_insights')
    .upsert(
      [
        {
          user_id: userId,
          category: targetCategory,
          insight_text: text,
          metrics_snapshot: metricsSnapshot as Json,
          evidence_type: selected.evidence_type,
          evidence: selected.evidence as Json,
          generated_at: generatedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
      ],
      { onConflict: 'user_id' },
    )
    .select('id,user_id,insight_text,category,metrics_snapshot,evidence_type,evidence,generated_at,expires_at')
    .single();

  if (error || !data) {
    return {
      id: 'fallback',
      user_id: userId,
      category: targetCategory,
      insight_text: selected.fact,
      metrics_snapshot: metricsSnapshot as Json,
      evidence_type: selected.evidence_type,
      evidence: selected.evidence as Json,
      generated_at: generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  }

  return data as InsightRecord;
}

