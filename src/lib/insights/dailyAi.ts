import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { Json, TableInsert, TableRow } from '@/lib/supabase/types';

type DailyAiInsight = TableRow<'daily_ai_insights'>;

type WindowStats = {
  window_days: number;
  hangout_count: number;
  dish_count: number;
  unique_restaurant_count: number;
  spend_total: number;
  go_to_count: number;
  never_again_count: number;
  top_dish: { name: string | null; count: number };
  top_restaurant: { name: string | null; count: number };
};

type ModelInsight = {
  insight_text: unknown;
  insight_type: unknown;
};

type ResponsesOutput = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      text?: unknown;
      json?: unknown;
    }>;
  }>;
};

function formatDateInNY(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function asStats(value: unknown, days: number): WindowStats {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const topDish = src.top_dish && typeof src.top_dish === 'object' ? (src.top_dish as Record<string, unknown>) : {};
  const topRestaurant =
    src.top_restaurant && typeof src.top_restaurant === 'object' ? (src.top_restaurant as Record<string, unknown>) : {};

  return {
    window_days: asNumber(src.window_days, days),
    hangout_count: asNumber(src.hangout_count),
    dish_count: asNumber(src.dish_count),
    unique_restaurant_count: asNumber(src.unique_restaurant_count),
    spend_total: asNumber(src.spend_total),
    go_to_count: asNumber(src.go_to_count),
    never_again_count: asNumber(src.never_again_count),
    top_dish: {
      name: asNullableString(topDish.name),
      count: asNumber(topDish.count),
    },
    top_restaurant: {
      name: asNullableString(topRestaurant.name),
      count: asNumber(topRestaurant.count),
    },
  };
}

function normalizeInsightType(value: unknown): string {
  if (typeof value !== 'string') return 'habit';
  const cleaned = value.trim().toLowerCase();
  const allowed = new Set(['habit', 'palate', 'explore', 'spend', 'crew']);
  return allowed.has(cleaned) ? cleaned : 'habit';
}

function fallbackInsight(stats30: WindowStats): { insight_text: string; insight_type: string } {
  if (stats30.hangout_count === 0) {
    return {
      insight_text: 'Log one hangout today and I will generate a personalized trend tomorrow.',
      insight_type: 'habit',
    };
  }

  if (stats30.top_dish.name && stats30.top_dish.count >= 2) {
    return {
      insight_text: `${stats30.top_dish.name} has shown up ${stats30.top_dish.count} times in your last 30 days.`,
      insight_type: 'palate',
    };
  }

  if (stats30.top_restaurant.name && stats30.top_restaurant.count >= 2) {
    return {
      insight_text: `${stats30.top_restaurant.name} is your most visited spot lately at ${stats30.top_restaurant.count} hangouts.`,
      insight_type: 'explore',
    };
  }

  return {
    insight_text: `You logged ${stats30.hangout_count} hangouts and ${stats30.dish_count} dishes in the last 30 days.`,
    insight_type: 'habit',
  };
}

function parseModelInsight(payload: ResponsesOutput): { insight_text: string; insight_type: string } | null {
  const jsonFromParts = payload.output?.flatMap((item) => item.content ?? []).find((part) => part.json && typeof part.json === 'object')
    ?.json;

  let parsed: ModelInsight | null = null;
  if (jsonFromParts && typeof jsonFromParts === 'object') {
    parsed = jsonFromParts as ModelInsight;
  } else {
    const textCandidate =
      (typeof payload.output_text === 'string' ? payload.output_text : null) ??
      (payload.output?.flatMap((item) => item.content ?? []).find((part) => typeof part.text === 'string')?.text as string | undefined) ??
      null;

    if (!textCandidate) return null;

    try {
      parsed = JSON.parse(textCandidate) as ModelInsight;
    } catch {
      const start = textCandidate.indexOf('{');
      const end = textCandidate.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try {
        parsed = JSON.parse(textCandidate.slice(start, end + 1)) as ModelInsight;
      } catch {
        return null;
      }
    }
  }

  if (!parsed) return null;

  const insightText = asNullableString(parsed.insight_text);
  if (!insightText) return null;

  return {
    insight_text: insightText.length <= 180 ? insightText : `${insightText.slice(0, 177)}...`,
    insight_type: normalizeInsightType(parsed.insight_type),
  };
}

async function phraseInsightWithOpenAI(params: {
  stats7: WindowStats;
  stats14: WindowStats;
  stats30: WindowStats;
}): Promise<{ insight_text: string; insight_type: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are writing one daily insight for a food journal app user.
Return JSON only in this shape:
{"insight_text":"...","insight_type":"habit|palate|explore|spend|crew"}
Rules:
- Exactly one sentence.
- Keep it warm and specific.
- Use only the structured stats provided.
- No numbers with more than 2 decimals.
- Max 180 characters.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: prompt }] },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                stats_7d: params.stats7,
                stats_14d: params.stats14,
                stats_30d: params.stats30,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'daily_insight',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['insight_text', 'insight_type'],
            properties: {
              insight_text: { type: 'string' },
              insight_type: { type: 'string' },
            },
          },
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as ResponsesOutput;
  return parseModelInsight(payload);
}

export async function getDailyInsight(userId: string): Promise<DailyAiInsight> {
  const service = getServiceSupabaseClient();
  const now = new Date();
  const insightDate = formatDateInNY(now);

  const { data: cached } = await service
    .from('daily_ai_insights')
    .select('*')
    .eq('user_id', userId)
    .eq('insight_date', insightDate)
    .maybeSingle();

  if (cached) return cached as DailyAiInsight;

  const [stats7Result, stats14Result, stats30Result] = await Promise.all([
    service.rpc('daily_insight_stats_7d', { p_user_id: userId }),
    service.rpc('daily_insight_stats_14d', { p_user_id: userId }),
    service.rpc('daily_insight_stats_30d', { p_user_id: userId }),
  ]);

  const stats7 = asStats(stats7Result.data, 7);
  const stats14 = asStats(stats14Result.data, 14);
  const stats30 = asStats(stats30Result.data, 30);

  const modelInsight = await phraseInsightWithOpenAI({ stats7, stats14, stats30 });
  const fallback = fallbackInsight(stats30);
  const insight = modelInsight ?? fallback;

  const metadata = {
    stats_7d: stats7,
    stats_14d: stats14,
    stats_30d: stats30,
    source: modelInsight ? 'openai' : 'fallback',
  };

  const payload: TableInsert<'daily_ai_insights'> = {
    user_id: userId,
    insight_date: insightDate,
    insight_text: insight.insight_text,
    insight_type: insight.insight_type,
    metadata: metadata as Json,
    generated_at: now.toISOString(),
  };

  const { data, error } = await service
    .from('daily_ai_insights')
    .upsert(payload, { onConflict: 'user_id,insight_date' })
    .select('*')
    .single();

  if (error || !data) {
    return {
      user_id: userId,
      insight_date: insightDate,
      insight_text: insight.insight_text,
      insight_type: insight.insight_type,
      metadata: metadata as Json,
      generated_at: now.toISOString(),
    };
  }

  return data as DailyAiInsight;
}
