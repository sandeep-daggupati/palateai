import { Json } from '@/lib/supabase/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type InsightCategory = 'palate' | 'explore' | 'spend';
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

type InsightCandidate = {
  category: InsightCategory;
  evidence_type: EvidenceType;
  evidence: Record<string, unknown>;
  metrics_snapshot: Record<string, unknown>;
  strength_score: number;
  fallbackText: string;
};

type DataBundle = {
  dishes30: DishRow[];
  dishesAll: DishRow[];
  hangouts30: HangoutRow[];
  hangoutsAll: HangoutRow[];
  restaurantsById: Map<string, string>;
};

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function stableDishKey(name: string): string {
  return name.trim().toLowerCase();
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

  const userIds = Array.from(new Set([...(hostUserId ? [hostUserId] : []), ...participantIds]));
  if (userIds.length === 0) return [];

  const { data: profiles } = await service.from('profiles').select('id,display_name,avatar_url').in('id', userIds);
  const lookup = new Map((profiles ?? []).map((row) => [row.id, row]));

  return userIds.slice(0, 5).map((id) => {
    const profile = lookup.get(id);
    return {
      display_name: profile?.display_name?.trim() || 'Buddy',
      avatar_url: profile?.avatar_url ?? null,
    };
  });
}

async function loadDataBundle(service: ReturnType<typeof getServiceSupabaseClient>, userId: string): Promise<DataBundle> {
  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);

  const { data: dishesAllRaw } = await service
    .from('dish_entries')
    .select('dish_name,restaurant_id,source_upload_id,eaten_at,created_at,identity_tag,price_original,quantity,rating')
    .eq('user_id', userId)
    .limit(8000);

  const dishesAll = (dishesAllRaw ?? []) as DishRow[];
  const dishes30 = dishesAll.filter((row) => parseTime(row.eaten_at ?? row.created_at) >= since30.getTime());

  const { data: hangoutsAllRaw } = await service
    .from('receipt_uploads')
    .select('id,user_id,restaurant_id,visited_at,created_at,status')
    .eq('user_id', userId)
    .neq('status', 'failed')
    .limit(4000);

  const hangoutsAll = (hangoutsAllRaw ?? []) as HangoutRow[];
  const hangouts30 = hangoutsAll.filter((row) => parseTime(row.visited_at ?? row.created_at) >= since30.getTime());

  const restaurantIds = Array.from(
    new Set([...dishesAll.map((row) => row.restaurant_id), ...hangoutsAll.map((row) => row.restaurant_id)].filter((id): id is string => Boolean(id))),
  );

  const restaurantsById = new Map<string, string>();
  if (restaurantIds.length > 0) {
    const { data: restaurantsRaw } = await service.from('restaurants').select('id,name').in('id', restaurantIds);
    for (const row of (restaurantsRaw ?? []) as RestaurantRow[]) {
      restaurantsById.set(row.id, row.name);
    }
  }

  return { dishes30, dishesAll, hangouts30, hangoutsAll, restaurantsById };
}

function baseMetrics(bundle: DataBundle): Record<string, unknown> {
  return {
    timeframe_days: 30,
    dishes_30d: bundle.dishes30.length,
    hangouts_30d: bundle.hangouts30.length,
    go_to_30d: bundle.dishes30.filter((row) => row.identity_tag === 'go_to').length,
    priced_items_30d: bundle.dishes30.filter((row) => typeof row.price_original === 'number').length,
  };
}

async function buildPalateCandidates(
  service: ReturnType<typeof getServiceSupabaseClient>,
  bundle: DataBundle,
): Promise<InsightCandidate[]> {
  const candidates: InsightCandidate[] = [];
  const metrics = baseMetrics(bundle);

  const goToDishes = bundle.dishes30.filter((row) => row.identity_tag === 'go_to');
  if (goToDishes.length > 0) {
    const counts = new Map<string, { count: number; lastAt: number; lastHangoutId: string; restaurantId: string | null }>();
    for (const row of goToDishes) {
      const key = stableDishKey(row.dish_name);
      const stamp = parseTime(row.eaten_at ?? row.created_at);
      const current = counts.get(key);
      if (!current) {
        counts.set(key, { count: 1, lastAt: stamp, lastHangoutId: row.source_upload_id, restaurantId: row.restaurant_id });
      } else {
        const isNewer = stamp > current.lastAt;
        counts.set(key, {
          count: current.count + 1,
          lastAt: isNewer ? stamp : current.lastAt,
          lastHangoutId: isNewer ? row.source_upload_id : current.lastHangoutId,
          restaurantId: isNewer ? row.restaurant_id : current.restaurantId,
        });
      }
    }

    const top = Array.from(counts.entries()).sort((a, b) => (b[1].count - a[1].count) || (b[1].lastAt - a[1].lastAt))[0];
    if (top) {
      const dishName = goToDishes.find((row) => stableDishKey(row.dish_name) === top[0])?.dish_name ?? top[0];
      const hangout = bundle.hangoutsAll.find((row) => row.id === top[1].lastHangoutId);
      const restaurantName = top[1].restaurantId ? bundle.restaurantsById.get(top[1].restaurantId) ?? 'Unknown restaurant' : 'Unknown restaurant';
      const crew = await crewPreviewForHangout(service, top[1].lastHangoutId, hangout?.user_id ?? null);

      candidates.push({
        category: 'palate',
        evidence_type: 'dish',
        strength_score: top[1].count + 1,
        metrics_snapshot: {
          ...metrics,
          signal: 'top_go_to_dish',
          dish_name: dishName,
          go_to_count: top[1].count,
        },
        evidence: {
          dish_name: dishName,
          frequency: top[1].count,
          restaurant_name: restaurantName,
          last_hangout_id: top[1].lastHangoutId,
          last_hangout_date: formatDate(hangout?.visited_at ?? hangout?.created_at),
          crew_preview: crew,
        },
        fallbackText: `${dishName} is your strongest GO-TO this month (${top[1].count} logs).`,
      });
    }
  }

  if (bundle.hangouts30.length > 0) {
    const byRestaurant = new Map<string, { count: number; lastAt: number; lastHangoutId: string }>();
    for (const row of bundle.hangouts30) {
      if (!row.restaurant_id) continue;
      const stamp = parseTime(row.visited_at ?? row.created_at);
      const current = byRestaurant.get(row.restaurant_id);
      if (!current) {
        byRestaurant.set(row.restaurant_id, { count: 1, lastAt: stamp, lastHangoutId: row.id });
      } else {
        const isNewer = stamp > current.lastAt;
        byRestaurant.set(row.restaurant_id, {
          count: current.count + 1,
          lastAt: isNewer ? stamp : current.lastAt,
          lastHangoutId: isNewer ? row.id : current.lastHangoutId,
        });
      }
    }

    const topRestaurant = Array.from(byRestaurant.entries()).sort((a, b) => (b[1].count - a[1].count) || (b[1].lastAt - a[1].lastAt))[0];
    if (topRestaurant && topRestaurant[1].count >= 2) {
      const restaurantName = bundle.restaurantsById.get(topRestaurant[0]) ?? 'Unknown restaurant';
      const hangout = bundle.hangoutsAll.find((row) => row.id === topRestaurant[1].lastHangoutId);
      const crew = await crewPreviewForHangout(service, topRestaurant[1].lastHangoutId, hangout?.user_id ?? null);

      candidates.push({
        category: 'palate',
        evidence_type: 'restaurant',
        strength_score: topRestaurant[1].count,
        metrics_snapshot: {
          ...metrics,
          signal: 'repeat_restaurant',
          restaurant_name: restaurantName,
          restaurant_count: topRestaurant[1].count,
        },
        evidence: {
          restaurant_name: restaurantName,
          hangout_count: topRestaurant[1].count,
          last_hangout_id: topRestaurant[1].lastHangoutId,
          last_hangout_date: formatDate(hangout?.visited_at ?? hangout?.created_at),
          crew_preview: crew,
        },
        fallbackText: `${restaurantName} has been your most repeated hangout spot this month (${topRestaurant[1].count} visits).`,
      });
    }
  }

  return candidates;
}

async function buildExploreCandidates(bundle: DataBundle): Promise<InsightCandidate[]> {
  const candidates: InsightCandidate[] = [];
  const metrics = baseMetrics(bundle);

  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);
  const sinceMs = since30.getTime();

  const priorRestaurantIds = new Set(
    bundle.hangoutsAll
      .filter((row) => parseTime(row.visited_at ?? row.created_at) < sinceMs)
      .map((row) => row.restaurant_id)
      .filter((id): id is string => Boolean(id)),
  );

  const newRestaurants = Array.from(
    new Set(
      bundle.hangouts30
        .map((row) => row.restaurant_id)
        .filter((id): id is string => Boolean(id))
        .filter((id) => !priorRestaurantIds.has(id)),
    ),
  );

  if (newRestaurants.length > 0) {
    const names = newRestaurants.slice(0, 3).map((id) => bundle.restaurantsById.get(id) ?? 'Unknown restaurant');
    candidates.push({
      category: 'explore',
      evidence_type: 'summary',
      strength_score: newRestaurants.length,
      metrics_snapshot: {
        ...metrics,
        signal: 'new_places',
        new_place_count: newRestaurants.length,
      },
      evidence: {
        metrics: [
          { label: 'New places this month', value: newRestaurants.length },
          { label: 'Hangouts this month', value: bundle.hangouts30.length },
        ],
        new_places: names,
      },
      fallbackText: `You explored ${newRestaurants.length} new place${newRestaurants.length === 1 ? '' : 's'} this month.`,
    });
  }

  const priorDishNames = new Set(
    bundle.dishesAll
      .filter((row) => parseTime(row.eaten_at ?? row.created_at) < sinceMs)
      .map((row) => stableDishKey(row.dish_name)),
  );

  const newDishRows = bundle.dishes30.filter((row) => !priorDishNames.has(stableDishKey(row.dish_name)));
  const newDishNames = Array.from(new Set(newDishRows.map((row) => row.dish_name)));
  if (newDishNames.length > 0) {
    candidates.push({
      category: 'explore',
      evidence_type: 'summary',
      strength_score: Math.max(1, newDishNames.length * 0.8),
      metrics_snapshot: {
        ...metrics,
        signal: 'new_dishes',
        new_dish_count: newDishNames.length,
      },
      evidence: {
        metrics: [
          { label: 'New dishes this month', value: newDishNames.length },
          { label: 'Total dishes this month', value: bundle.dishes30.length },
        ],
        new_dishes: newDishNames.slice(0, 4),
      },
      fallbackText: `${newDishNames.length} of your dishes this month were first-time logs for you.`,
    });
  }

  const throwback = bundle.dishesAll
    .filter((row) => (row.rating ?? 0) >= 4 && parseTime(row.eaten_at ?? row.created_at) < sinceMs)
    .sort((a, b) => parseTime(a.eaten_at ?? a.created_at) - parseTime(b.eaten_at ?? b.created_at))[0];

  if (throwback) {
    const restaurantName = throwback.restaurant_id ? bundle.restaurantsById.get(throwback.restaurant_id) ?? 'Unknown restaurant' : 'Unknown restaurant';
    candidates.push({
      category: 'explore',
      evidence_type: 'dish',
      strength_score: (throwback.rating ?? 0) + 0.5,
      metrics_snapshot: {
        ...metrics,
        signal: 'throwback_high_rated',
        throwback_dish: throwback.dish_name,
      },
      evidence: {
        dish_name: throwback.dish_name,
        rating: throwback.rating,
        restaurant_name: restaurantName,
        last_hangout_id: throwback.source_upload_id,
        last_hangout_date: formatDate(throwback.eaten_at ?? throwback.created_at),
      },
      fallbackText: `${throwback.dish_name} is a high-rated throwback from your earlier logs.`,
    });
  }

  return candidates;
}

async function buildSpendCandidates(bundle: DataBundle): Promise<InsightCandidate[]> {
  const candidates: InsightCandidate[] = [];
  const metrics = baseMetrics(bundle);

  const since7 = new Date();
  since7.setDate(since7.getDate() - 7);
  const since7Ms = since7.getTime();

  const priced7 = bundle.dishesAll.filter((row) => typeof row.price_original === 'number' && parseTime(row.eaten_at ?? row.created_at) >= since7Ms);
  if (priced7.length > 0) {
    const totalSpend = priced7.reduce((sum, row) => sum + (row.price_original ?? 0) * Math.max(1, row.quantity ?? 1), 0);
    candidates.push({
      category: 'spend',
      evidence_type: 'summary',
      strength_score: Math.max(1, totalSpend / 25),
      metrics_snapshot: {
        ...metrics,
        signal: 'weekly_spend',
        weekly_spend: Number(totalSpend.toFixed(2)),
      },
      evidence: {
        metrics: [
          { label: 'Spend in last 7 days', value: Number(totalSpend.toFixed(2)) },
          { label: 'Priced items in last 7 days', value: priced7.length },
        ],
      },
      fallbackText: `Your logged spend in the last 7 days is ${totalSpend.toFixed(2)} across ${priced7.length} priced items.`,
    });
  }

  const pricedAll = bundle.dishesAll
    .filter((row) => typeof row.price_original === 'number' && (row.price_original ?? 0) >= 0)
    .sort((a, b) => (a.price_original ?? 0) - (b.price_original ?? 0));

  const cheapest = pricedAll[0];
  if (cheapest) {
    const restaurantName = cheapest.restaurant_id ? bundle.restaurantsById.get(cheapest.restaurant_id) ?? 'Unknown restaurant' : 'Unknown restaurant';
    candidates.push({
      category: 'spend',
      evidence_type: 'dish',
      strength_score: Math.max(1, 10 - (cheapest.price_original ?? 0)),
      metrics_snapshot: {
        ...metrics,
        signal: 'cheapest_logged_item',
        cheapest_price: cheapest.price_original,
      },
      evidence: {
        dish_name: cheapest.dish_name,
        price: cheapest.price_original,
        restaurant_name: restaurantName,
        last_hangout_id: cheapest.source_upload_id,
        last_hangout_date: formatDate(cheapest.eaten_at ?? cheapest.created_at),
      },
      fallbackText: `${cheapest.dish_name} is your cheapest logged item at ${(cheapest.price_original ?? 0).toFixed(2)}.`,
    });
  }

  return candidates;
}

function pickCandidate(candidates: InsightCandidate[], recentCategories: InsightCategory[]): InsightCandidate {
  if (candidates.length === 0) {
    return {
      category: 'palate',
      evidence_type: 'summary',
      strength_score: 0,
      metrics_snapshot: { timeframe_days: 30 },
      evidence: {
        metrics: [{ label: 'Hangouts logged (30d)', value: 0 }],
      },
      fallbackText: "Your recent logs are still light, so today's insight is waiting for your next hangout.",
    };
  }

  let pool = [...candidates];
  const lastCategory = recentCategories[0];
  const hasAlt = pool.some((row) => row.category !== lastCategory);
  if (lastCategory && hasAlt) {
    pool = pool.filter((row) => row.category !== lastCategory);
  }

  const ranked = pool
    .map((row) => ({
      row,
      adjusted: row.strength_score + (recentCategories.includes(row.category) ? 0 : 0.75),
    }))
    .sort((a, b) => b.adjusted - a.adjusted);

  return ranked[0].row;
}

async function phraseInsight(candidate: InsightCandidate): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return candidate.fallbackText;

  const prompt = `Write exactly one calm observational sentence for a daily food-log insight.
- No advice.
- No hype.
- No extra facts.
- Keep it grounded in the JSON.

${JSON.stringify({ category: candidate.category, metrics_snapshot: candidate.metrics_snapshot, evidence: candidate.evidence })}`;

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

    if (!response.ok) return candidate.fallbackText;

    const payload = (await response.json()) as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ text?: unknown }> }>;
    };

    const outputText = typeof payload.output_text === 'string' ? payload.output_text : null;
    const fromParts = payload.output?.flatMap((entry) => entry.content ?? []).find((part) => typeof part.text === 'string')?.text;
    const text = (outputText ?? (typeof fromParts === 'string' ? fromParts : null))?.trim();

    if (!text) return candidate.fallbackText;
    const single = text.replace(/\s+/g, ' ').trim();
    return single.endsWith('.') ? single : `${single}.`;
  } catch {
    return candidate.fallbackText;
  }
}

async function buildCandidate(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
  recentCategories: InsightCategory[],
): Promise<InsightCandidate> {
  const bundle = await loadDataBundle(service, userId);

  const [palate, explore, spend] = await Promise.all([
    buildPalateCandidates(service, bundle),
    buildExploreCandidates(bundle),
    buildSpendCandidates(bundle),
  ]);

  const allCandidates = [...palate, ...explore, ...spend].filter((row) => row.strength_score > 0);
  return pickCandidate(allCandidates, recentCategories);
}

export async function getOrCreateDailyInsight(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
): Promise<InsightRecord> {
  const nowIso = new Date().toISOString();

  const { data: cached } = await service
    .from('daily_insights')
    .select('id,user_id,insight_text,category,metrics_snapshot,evidence_type,evidence,generated_at,expires_at')
    .eq('user_id', userId)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (cached) {
    return cached as InsightRecord;
  }

  const { data: recentHistory } = await service
    .from('daily_insight_history')
    .select('category,generated_at')
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(3);

  const recentCategories = (recentHistory ?? [])
    .map((row) => row.category)
    .filter((category): category is InsightCategory => category === 'palate' || category === 'explore' || category === 'spend');

  const candidate = await buildCandidate(service, userId, recentCategories);
  const insightText = await phraseInsight(candidate);

  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await service
    .from('daily_insights')
    .upsert(
      [
        {
          user_id: userId,
          insight_text: insightText,
          category: candidate.category,
          metrics_snapshot: candidate.metrics_snapshot as Json,
          evidence_type: candidate.evidence_type,
          evidence: candidate.evidence as Json,
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
      insight_text: candidate.fallbackText,
      category: candidate.category,
      metrics_snapshot: candidate.metrics_snapshot as Json,
      evidence_type: candidate.evidence_type,
      evidence: candidate.evidence as Json,
      generated_at: generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  }

  await service.from('daily_insight_history').insert({
    user_id: userId,
    insight_id: data.id,
    category: candidate.category,
    insight_text: insightText,
    generated_at: generatedAt.toISOString(),
  });

  return data as InsightRecord;
}
