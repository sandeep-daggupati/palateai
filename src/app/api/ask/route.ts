import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/supabase/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type AskContext = {
  lastRestaurantName?: string;
  lastRestaurantId?: string;
  lastPlaceId?: string;
  lastHangoutId?: string;
  lastDishName?: string;
  lastIntent?: string;
};

type AskBody = {
  question?: string;
  context?: AskContext;
};

type AskIntent =
  | 'favorite_dish'
  | 'last_hangout'
  | 'hangout_count_for_restaurant'
  | 'go_tos_lately'
  | 'dishes_from_last_hangout'
  | 'most_visited_restaurant'
  | 'cheapest_logged_item'
  | 'unsupported';

type Classification = {
  intent: AskIntent;
  restaurant_name?: string;
  wants_followup?: boolean;
  needs_clarification?: boolean;
  clarification_question?: string;
};

const FALLBACK_NO_DATA = "I don't have that in your logs yet. Add a hangout and I'll learn.";
const UNSUPPORTED_MESSAGE =
  'I can answer questions about your PalateAI logs for now. Try asking about your favorite dish or last hangout.';

function getAnonSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing Supabase public environment variables.');
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function authorize(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return { error: NextResponse.json({ ok: false, error: 'Missing auth token' }, { status: 401 }) };
  }

  const anon = getAnonSupabaseClient();
  const {
    data: { user },
    error,
  } = await anon.auth.getUser(token);

  if (error || !user) {
    return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  return { user };
}

function heuristicClassify(question: string): Classification {
  const q = question.toLowerCase();

  const atMatch = q.match(/\bat\s+([a-z0-9 '&.-]{2,})/i);
  const restaurantName = atMatch?.[1]?.trim();

  if (q.includes('favorite') && q.includes('dish')) {
    return { intent: 'favorite_dish', restaurant_name: restaurantName };
  }
  if (q.includes('go-to') || q.includes('go to') || q.includes('go_tos')) {
    return { intent: 'go_tos_lately', restaurant_name: restaurantName };
  }
  if (q.includes('most visited')) {
    return { intent: 'most_visited_restaurant' };
  }
  if (q.includes('cheapest')) {
    return { intent: 'cheapest_logged_item' };
  }
  if ((q.includes('how many') || q.includes('count')) && q.includes('hangout')) {
    return { intent: 'hangout_count_for_restaurant', restaurant_name: restaurantName };
  }
  if (q.includes('last hangout')) {
    return { intent: 'last_hangout', restaurant_name: restaurantName };
  }
  if (q.includes('what did i order') || q.includes('what did i have') || q.includes('dishes from')) {
    return { intent: 'dishes_from_last_hangout', restaurant_name: restaurantName, wants_followup: true };
  }

  return { intent: 'unsupported' };
}

async function classifyIntent(question: string, context: AskContext): Promise<Classification> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return heuristicClassify(question);

  const prompt = `
Classify the user's question into one whitelisted intent only.

Allowed intents:
- favorite_dish
- last_hangout
- hangout_count_for_restaurant
- go_tos_lately
- dishes_from_last_hangout
- most_visited_restaurant
- cheapest_logged_item
- unsupported

Return ONLY JSON:
{
  "intent": string,
  "restaurant_name": string | null,
  "wants_followup": boolean,
  "needs_clarification": boolean,
  "clarification_question": string | null
}

Rules:
- Extract restaurant_name if explicitly mentioned.
- If question is follow-up and no explicit restaurant_name, use context only when it clearly helps.
- If ambiguous and missing needed reference, set needs_clarification=true and provide a short clarification question.

Question: ${question}
Context: ${JSON.stringify(context)}
`;

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
        text: { format: { type: 'json_object' } },
      }),
    });

    if (!response.ok) return heuristicClassify(question);

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };

    const modelText =
      (typeof payload.output_text === 'string' && payload.output_text) ||
      payload.output?.flatMap((entry) => entry.content ?? []).find((part) => typeof part.text === 'string')?.text ||
      null;

    if (!modelText) return heuristicClassify(question);

    const parsed = JSON.parse(modelText) as {
      intent?: AskIntent;
      restaurant_name?: string | null;
      wants_followup?: boolean;
      needs_clarification?: boolean;
      clarification_question?: string | null;
    };

    const intent = parsed.intent ?? 'unsupported';
    if (
      ![
        'favorite_dish',
        'last_hangout',
        'hangout_count_for_restaurant',
        'go_tos_lately',
        'dishes_from_last_hangout',
        'most_visited_restaurant',
        'cheapest_logged_item',
        'unsupported',
      ].includes(intent)
    ) {
      return { intent: 'unsupported' };
    }

    return {
      intent,
      restaurant_name: parsed.restaurant_name ?? undefined,
      wants_followup: parsed.wants_followup ?? false,
      needs_clarification: parsed.needs_clarification ?? false,
      clarification_question: parsed.clarification_question ?? undefined,
    };
  } catch {
    return heuristicClassify(question);
  }
}

async function resolveRestaurant(service: ReturnType<typeof getServiceSupabaseClient>, userId: string, restaurantName?: string) {
  if (!restaurantName) return null;

  const { data } = await service
    .from('restaurants')
    .select('id,name,place_id')
    .eq('user_id', userId)
    .ilike('name', `%${restaurantName}%`)
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

async function queryFavoriteDish(service: ReturnType<typeof getServiceSupabaseClient>, userId: string) {
  const { data } = await service
    .from('dish_entries')
    .select('dish_name')
    .eq('user_id', userId)
    .eq('identity_tag', 'go_to')
    .limit(600);

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.dish_name, (counts.get(row.dish_name) ?? 0) + 1);

  const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  return { dishName: best[0], count: best[1] };
}

async function queryLastHangout(service: ReturnType<typeof getServiceSupabaseClient>, userId: string, restaurantId?: string) {
  let query = service
    .from('receipt_uploads')
    .select('id,restaurant_id,visited_at,created_at,visit_note')
    .eq('user_id', userId)
    .order('visited_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (restaurantId) query = query.eq('restaurant_id', restaurantId);

  const { data } = await query.maybeSingle();
  return data ?? null;
}

async function queryHangoutCount(service: ReturnType<typeof getServiceSupabaseClient>, userId: string, restaurantId: string) {
  const { count } = await service
    .from('receipt_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId);

  return count ?? 0;
}

async function queryGoTosLately(service: ReturnType<typeof getServiceSupabaseClient>, userId: string) {
  const since = new Date();
  since.setDate(since.getDate() - 60);

  const { data } = await service
    .from('dish_entries')
    .select('dish_name')
    .eq('user_id', userId)
    .eq('identity_tag', 'go_to')
    .gte('eaten_at', since.toISOString())
    .limit(600);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.dish_name, (counts.get(row.dish_name) ?? 0) + 1);

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));
}

async function queryDishesFromHangout(service: ReturnType<typeof getServiceSupabaseClient>, userId: string, hangoutId: string) {
  const { data } = await service
    .from('dish_entries')
    .select('dish_name,quantity,price_original')
    .eq('user_id', userId)
    .eq('source_upload_id', hangoutId)
    .order('created_at', { ascending: true })
    .limit(300);

  return data ?? [];
}

async function queryMostVisitedRestaurant(service: ReturnType<typeof getServiceSupabaseClient>, userId: string) {
  const { data } = await service
    .from('receipt_uploads')
    .select('restaurant_id')
    .eq('user_id', userId)
    .not('restaurant_id', 'is', null)
    .limit(1000);

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.restaurant_id) continue;
    counts.set(row.restaurant_id, (counts.get(row.restaurant_id) ?? 0) + 1);
  }

  const [restaurantId, visits] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const { data: restaurant } = await service.from('restaurants').select('id,name,place_id').eq('id', restaurantId).maybeSingle();

  return restaurant ? { restaurant, visits } : null;
}

async function queryCheapestItem(service: ReturnType<typeof getServiceSupabaseClient>, userId: string) {
  const { data } = await service
    .from('dish_entries')
    .select('dish_name,price_original,currency_original,source_upload_id')
    .eq('user_id', userId)
    .not('price_original', 'is', null)
    .order('price_original', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;

  const body = (await request.json()) as AskBody;
  const question = body.question?.trim() ?? '';
  const context = body.context ?? {};

  if (!question) {
    return NextResponse.json({ ok: false, error: 'Question is required.' }, { status: 400 });
  }

  const service = getServiceSupabaseClient();
  const classification = await classifyIntent(question, context);

  if (classification.intent === 'unsupported') {
    return NextResponse.json({ ok: true, answer: UNSUPPORTED_MESSAGE, intent: 'unsupported' });
  }

  const effectiveRestaurantName = classification.restaurant_name ?? context.lastRestaurantName;
  const restaurant = await resolveRestaurant(service, auth.user.id, effectiveRestaurantName);

  const contextUpdates: AskContext = { lastIntent: classification.intent };

  if (restaurant) {
    contextUpdates.lastRestaurantName = restaurant.name;
    contextUpdates.lastRestaurantId = restaurant.id;
    contextUpdates.lastPlaceId = restaurant.place_id ?? undefined;
  }

  if (classification.intent === 'dishes_from_last_hangout') {
    const hangoutId = context.lastHangoutId;

    if (!hangoutId && !restaurant?.id) {
      return NextResponse.json({
        ok: true,
        intent: classification.intent,
        needsClarification: true,
        clarificationQuestion: "Which hangout do you mean? Try 'last hangout at Popeyes'.",
        contextUpdates,
      });
    }

    const fallbackHangout = hangoutId ? { id: hangoutId } : await queryLastHangout(service, auth.user.id, restaurant?.id);

    if (!fallbackHangout?.id) {
      return NextResponse.json({ ok: true, intent: classification.intent, answer: FALLBACK_NO_DATA, contextUpdates });
    }

    const dishes = await queryDishesFromHangout(service, auth.user.id, fallbackHangout.id);
    if (dishes.length === 0) {
      return NextResponse.json({ ok: true, intent: classification.intent, answer: FALLBACK_NO_DATA, contextUpdates });
    }

    contextUpdates.lastHangoutId = fallbackHangout.id;
    contextUpdates.lastDishName = dishes[0].dish_name;

    const top = dishes.slice(0, 5).map((row) => `${row.dish_name}${row.quantity && row.quantity > 1 ? ` x${row.quantity}` : ''}`);
    return NextResponse.json({ ok: true, intent: classification.intent, answer: `From that hangout: ${top.join(', ')}.`, contextUpdates });
  }

  if (classification.intent === 'favorite_dish') {
    const favorite = await queryFavoriteDish(service, auth.user.id);
    if (!favorite) return NextResponse.json({ ok: true, intent: classification.intent, answer: FALLBACK_NO_DATA, contextUpdates });

    contextUpdates.lastDishName = favorite.dishName;
    return NextResponse.json({
      ok: true,
      intent: classification.intent,
      answer: `Your favorite looks like ${favorite.dishName} (${favorite.count} GO-TO logs).`,
      contextUpdates,
    });
  }

  if (classification.intent === 'last_hangout') {
    const hangout = await queryLastHangout(service, auth.user.id, restaurant?.id);
    if (!hangout) return NextResponse.json({ ok: true, intent: classification.intent, answer: FALLBACK_NO_DATA, contextUpdates });

    contextUpdates.lastHangoutId = hangout.id;
    const date = new Date(hangout.visited_at ?? hangout.created_at ?? new Date().toISOString()).toLocaleDateString();
    const restaurantPart = restaurant?.name ? ` at ${restaurant.name}` : '';

    return NextResponse.json({ ok: true, intent: classification.intent, answer: `Your last hangout${restaurantPart} was on ${date}.`, contextUpdates });
  }

  if (classification.intent === 'hangout_count_for_restaurant') {
    if (!restaurant?.id) {
      return NextResponse.json({
        ok: true,
        intent: classification.intent,
        needsClarification: true,
        clarificationQuestion: 'Which restaurant should I check?',
        contextUpdates,
      });
    }

    const count = await queryHangoutCount(service, auth.user.id, restaurant.id);
    return NextResponse.json({
      ok: true,
      intent: classification.intent,
      answer: `You've logged ${count} hangout${count === 1 ? '' : 's'} at ${restaurant.name}.`,
      contextUpdates,
    });
  }

  if (classification.intent === 'go_tos_lately') {
    const rows = await queryGoTosLately(service, auth.user.id);
    if (rows.length === 0) return NextResponse.json({ ok: true, intent: classification.intent, answer: FALLBACK_NO_DATA, contextUpdates });

    contextUpdates.lastDishName = rows[0].name;
    const list = rows.map((row) => `${row.name} (${row.count})`).join(', ');
    return NextResponse.json({ ok: true, intent: classification.intent, answer: `Your GO-TOs lately: ${list}.`, contextUpdates });
  }

  if (classification.intent === 'most_visited_restaurant') {
    const most = await queryMostVisitedRestaurant(service, auth.user.id);
    if (!most) return NextResponse.json({ ok: true, intent: classification.intent, answer: FALLBACK_NO_DATA, contextUpdates });

    contextUpdates.lastRestaurantName = most.restaurant.name;
    contextUpdates.lastRestaurantId = most.restaurant.id;
    contextUpdates.lastPlaceId = most.restaurant.place_id ?? undefined;

    return NextResponse.json({
      ok: true,
      intent: classification.intent,
      answer: `Your most visited spot is ${most.restaurant.name} with ${most.visits} hangouts.`,
      contextUpdates,
    });
  }

  if (classification.intent === 'cheapest_logged_item') {
    const cheapest = await queryCheapestItem(service, auth.user.id);
    if (!cheapest) return NextResponse.json({ ok: true, intent: classification.intent, answer: FALLBACK_NO_DATA, contextUpdates });

    contextUpdates.lastDishName = cheapest.dish_name;
    contextUpdates.lastHangoutId = cheapest.source_upload_id;

    return NextResponse.json({
      ok: true,
      intent: classification.intent,
      answer: `Your cheapest logged item is ${cheapest.dish_name} at ${cheapest.currency_original} ${cheapest.price_original?.toFixed(2)}.`,
      contextUpdates,
    });
  }

  return NextResponse.json({ ok: true, answer: UNSUPPORTED_MESSAGE, intent: 'unsupported', contextUpdates });
}
