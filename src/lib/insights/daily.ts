import { Json } from '@/lib/supabase/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type EvidenceType = 'dish' | 'restaurant' | 'hangout' | 'summary';

type CrewPreview = Array<{ display_name: string; avatar_url: string | null }>;

type InsightRecord = {
  id: string;
  user_id: string;
  insight_text: string;
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
  evidence_type: EvidenceType;
  metrics_snapshot: Record<string, unknown>;
  evidence: Record<string, unknown>;
  fallbackText: string;
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

  const participantUserIds = (participantRows ?? [])
    .map((row) => row.user_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const allUserIds = Array.from(new Set([...(hostUserId ? [hostUserId] : []), ...participantUserIds]));
  if (allUserIds.length === 0) return [];

  const { data: profileRows } = await service
    .from('profiles')
    .select('id,display_name,avatar_url')
    .in('id', allUserIds);

  const profileLookup = new Map((profileRows ?? []).map((row) => [row.id, row]));

  return allUserIds.slice(0, 5).map((userId) => {
    const profile = profileLookup.get(userId);
    return {
      display_name: profile?.display_name?.trim() || 'Buddy',
      avatar_url: profile?.avatar_url ?? null,
    };
  });
}

async function phraseInsight(
  candidate: InsightCandidate,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return candidate.fallbackText;

  const prompt = `Write exactly one calm observational sentence for a daily food-log insight.
- No advice.
- No hype.
- No extra facts.
- Ground strictly in this JSON.

${JSON.stringify({ metrics_snapshot: candidate.metrics_snapshot as Json, evidence: candidate.evidence })}`;

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

    const oneLine = text.replace(/\s+/g, ' ').trim();
    const sentence = oneLine.endsWith('.') ? oneLine : `${oneLine}.`;
    return sentence;
  } catch {
    return candidate.fallbackText;
  }
}

async function buildCandidate(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
): Promise<InsightCandidate> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  const { data: dishesRaw } = await service
    .from('dish_entries')
    .select('dish_name,restaurant_id,source_upload_id,eaten_at,created_at,identity_tag')
    .eq('user_id', userId)
    .gte('created_at', sinceIso)
    .limit(2000);

  const dishes = (dishesRaw ?? []) as DishRow[];
  const hangoutIds = Array.from(new Set(dishes.map((row) => row.source_upload_id).filter(Boolean)));

  let hangouts: HangoutRow[] = [];
  if (hangoutIds.length > 0) {
    const { data: hangoutRows } = await service
      .from('receipt_uploads')
      .select('id,user_id,restaurant_id,visited_at,created_at,status')
      .in('id', hangoutIds)
      .neq('status', 'failed')
      .limit(2000);

    hangouts = (hangoutRows ?? []) as HangoutRow[];
  }

  const restaurantIds = Array.from(
    new Set([...dishes.map((row) => row.restaurant_id), ...hangouts.map((row) => row.restaurant_id)].filter((id): id is string => Boolean(id))),
  );

  const restaurantsById = new Map<string, string>();
  if (restaurantIds.length > 0) {
    const { data: restaurantRows } = await service
      .from('restaurants')
      .select('id,name')
      .in('id', restaurantIds);

    for (const row of (restaurantRows ?? []) as RestaurantRow[]) {
      restaurantsById.set(row.id, row.name);
    }
  }

  const metricsSnapshot = {
    timeframe_days: 30,
    total_dishes: dishes.length,
    total_hangouts: hangouts.length,
    go_to_count: dishes.filter((row) => row.identity_tag === 'go_to').length,
  };

  const dishCounts = new Map<string, { name: string; count: number; lastAt: number; lastHangoutId: string; restaurantId: string | null }>();
  for (const row of dishes) {
    const key = stableDishKey(row.dish_name);
    const timestamp = Math.max(parseTime(row.eaten_at), parseTime(row.created_at));
    const current = dishCounts.get(key);

    if (!current) {
      dishCounts.set(key, {
        name: row.dish_name,
        count: 1,
        lastAt: timestamp,
        lastHangoutId: row.source_upload_id,
        restaurantId: row.restaurant_id,
      });
      continue;
    }

    const newer = timestamp > current.lastAt;
    dishCounts.set(key, {
      name: current.name,
      count: current.count + 1,
      lastAt: newer ? timestamp : current.lastAt,
      lastHangoutId: newer ? row.source_upload_id : current.lastHangoutId,
      restaurantId: newer ? row.restaurant_id : current.restaurantId,
    });
  }

  const topDish = Array.from(dishCounts.values()).sort((a, b) => (b.count - a.count) || (b.lastAt - a.lastAt))[0];
  if (topDish && topDish.count >= 3) {
    const hangout = hangouts.find((row) => row.id === topDish.lastHangoutId);
    const crewPreview = await crewPreviewForHangout(service, topDish.lastHangoutId, hangout?.user_id ?? null);
    const restaurantName = topDish.restaurantId ? restaurantsById.get(topDish.restaurantId) ?? 'Unknown restaurant' : 'Unknown restaurant';

    return {
      evidence_type: 'dish',
      metrics_snapshot: {
        ...metricsSnapshot,
        focus: 'dish',
        dish_name: topDish.name,
        dish_count: topDish.count,
      },
      evidence: {
        dish_name: topDish.name,
        frequency: topDish.count,
        restaurant_name: restaurantName,
        last_hangout_id: topDish.lastHangoutId,
        last_hangout_date: formatDate(hangout?.visited_at ?? hangout?.created_at),
        crew_preview: crewPreview,
      },
      fallbackText: `${topDish.name} keeps showing up in your logs this month (${topDish.count} times).`,
    };
  }

  const restaurantCounts = new Map<string, { name: string; count: number; lastAt: number; lastHangoutId: string }>();
  for (const row of hangouts) {
    if (!row.restaurant_id) continue;
    const name = restaurantsById.get(row.restaurant_id) ?? 'Unknown restaurant';
    const timestamp = Math.max(parseTime(row.visited_at), parseTime(row.created_at));
    const current = restaurantCounts.get(row.restaurant_id);

    if (!current) {
      restaurantCounts.set(row.restaurant_id, { name, count: 1, lastAt: timestamp, lastHangoutId: row.id });
      continue;
    }

    const newer = timestamp > current.lastAt;
    restaurantCounts.set(row.restaurant_id, {
      name: current.name,
      count: current.count + 1,
      lastAt: newer ? timestamp : current.lastAt,
      lastHangoutId: newer ? row.id : current.lastHangoutId,
    });
  }

  const topRestaurantEntry = Array.from(restaurantCounts.entries())
    .map(([restaurantId, value]) => ({ restaurantId, ...value }))
    .sort((a, b) => (b.count - a.count) || (b.lastAt - a.lastAt))[0];

  if (topRestaurantEntry && topRestaurantEntry.count >= 2) {
    const hangout = hangouts.find((row) => row.id === topRestaurantEntry.lastHangoutId);
    const crewPreview = await crewPreviewForHangout(service, topRestaurantEntry.lastHangoutId, hangout?.user_id ?? null);

    return {
      evidence_type: 'restaurant',
      metrics_snapshot: {
        ...metricsSnapshot,
        focus: 'restaurant',
        restaurant_name: topRestaurantEntry.name,
        hangout_count: topRestaurantEntry.count,
      },
      evidence: {
        restaurant_name: topRestaurantEntry.name,
        hangout_count: topRestaurantEntry.count,
        last_hangout_id: topRestaurantEntry.lastHangoutId,
        last_hangout_date: formatDate(hangout?.visited_at ?? hangout?.created_at),
        crew_preview: crewPreview,
      },
      fallbackText: `${topRestaurantEntry.name} appears most often in your last 30 days (${topRestaurantEntry.count} hangouts).`,
    };
  }

  const latestHangout = [...hangouts].sort((a, b) => Math.max(parseTime(b.visited_at), parseTime(b.created_at)) - Math.max(parseTime(a.visited_at), parseTime(a.created_at)))[0];
  if (latestHangout) {
    const hangoutDishes = dishes.filter((row) => row.source_upload_id === latestHangout.id);
    const counts = new Map<string, number>();
    for (const row of hangoutDishes) {
      counts.set(row.dish_name, (counts.get(row.dish_name) ?? 0) + 1);
    }
    const topDishEntry = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    const crewPreview = await crewPreviewForHangout(service, latestHangout.id, latestHangout.user_id);
    const restaurantName = latestHangout.restaurant_id ? restaurantsById.get(latestHangout.restaurant_id) ?? 'Unknown restaurant' : 'Unknown restaurant';

    return {
      evidence_type: 'hangout',
      metrics_snapshot: {
        ...metricsSnapshot,
        focus: 'hangout',
        hangout_id: latestHangout.id,
      },
      evidence: {
        hangout_id: latestHangout.id,
        restaurant_name: restaurantName,
        hangout_date: formatDate(latestHangout.visited_at ?? latestHangout.created_at),
        crew_preview: crewPreview,
        top_dish: topDishEntry ? topDishEntry[0] : null,
      },
      fallbackText: `Your latest hangout was at ${restaurantName}${topDishEntry ? `, and ${topDishEntry[0]} was on the list` : ''}.`,
    };
  }

  return {
    evidence_type: 'summary',
    metrics_snapshot: metricsSnapshot,
    evidence: {
      metrics: [
        { label: 'Hangouts logged (30d)', value: metricsSnapshot.total_hangouts },
        { label: 'Dishes logged (30d)', value: metricsSnapshot.total_dishes },
        { label: 'GO-TO tags (30d)', value: metricsSnapshot.go_to_count },
      ],
    },
    fallbackText: `You logged ${metricsSnapshot.total_dishes} dishes across ${metricsSnapshot.total_hangouts} hangouts in the last 30 days.`,
  };
}

export async function getOrCreateDailyInsight(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
): Promise<InsightRecord> {
  const nowIso = new Date().toISOString();

  const { data: cached } = await service
    .from('daily_insights')
    .select('id,user_id,insight_text,metrics_snapshot,evidence_type,evidence,generated_at,expires_at')
    .eq('user_id', userId)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (cached) {
    return cached as InsightRecord;
  }

  const candidate = await buildCandidate(service, userId);
  const insightText = await phraseInsight(candidate);

  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await service
    .from('daily_insights')
    .upsert(
      {
        user_id: userId,
        insight_text: insightText,
        metrics_snapshot: candidate.metrics_snapshot as Json,
        evidence_type: candidate.evidence_type,
        evidence: candidate.evidence as Json,
        generated_at: generatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('id,user_id,insight_text,metrics_snapshot,evidence_type,evidence,generated_at,expires_at')
    .single();

  if (error || !data) {
    return {
      id: 'fallback',
      user_id: userId,
      insight_text: candidate.fallbackText,
      metrics_snapshot: candidate.metrics_snapshot as Json,
      evidence_type: candidate.evidence_type,
      evidence: candidate.evidence as Json,
      generated_at: generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  }

  return data as InsightRecord;
}


