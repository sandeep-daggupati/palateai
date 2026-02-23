import { classifyQuestion } from '@/lib/ask/classify';
import { resolveRestaurantByName, mergeContext } from '@/lib/ask/handlers/_shared';
import { cheapestLoggedItemHandler } from '@/lib/ask/handlers/cheapestLoggedItem';
import { dishesAtRestaurantHandler } from '@/lib/ask/handlers/dishesAtRestaurant';
import { favoriteDishHandler } from '@/lib/ask/handlers/favoriteDish';
import { goTosLatelyHandler } from '@/lib/ask/handlers/goTosLately';
import { hangoutRecapHandler } from '@/lib/ask/handlers/hangoutRecap';
import { identitySummaryHandler } from '@/lib/ask/handlers/identitySummary';
import { lastHangoutHandler } from '@/lib/ask/handlers/lastHangout';
import { mostVisitedRestaurantHandler } from '@/lib/ask/handlers/mostVisitedRestaurant';
import {
  AskContext,
  AskHandlerInput,
  AskIntent,
  AskResponsePayload,
  CLARIFICATION_HANGOUT,
  CLARIFICATION_RESTAURANT,
  DEFAULT_CONTEXT,
  PARSE_FALLBACK_MESSAGE,
  ResolvedParams,
  UNSUPPORTED_MESSAGE,
} from '@/lib/ask/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type Handler = (input: AskHandlerInput) => Promise<{ answer: string; context_update?: Partial<AskContext> }>;

const handlers: Record<Exclude<AskIntent, 'unsupported'>, Handler> = {
  favorite_dish: favoriteDishHandler,
  go_tos_lately: goTosLatelyHandler,
  last_hangout: lastHangoutHandler,
  hangout_recap: hangoutRecapHandler,
  dishes_at_restaurant: dishesAtRestaurantHandler,
  most_visited_restaurant: mostVisitedRestaurantHandler,
  identity_summary: identitySummaryHandler,
  cheapest_logged_item: cheapestLoggedItemHandler,
};

function toSafeContext(context: Partial<AskContext> | null | undefined): AskContext {
  return {
    lastRestaurantName: typeof context?.lastRestaurantName === 'string' ? context.lastRestaurantName : null,
    lastRestaurantId: typeof context?.lastRestaurantId === 'string' ? context.lastRestaurantId : null,
    lastHangoutId: typeof context?.lastHangoutId === 'string' ? context.lastHangoutId : null,
    lastDishName: typeof context?.lastDishName === 'string' ? context.lastDishName : null,
    lastIntent: typeof context?.lastIntent === 'string' ? context.lastIntent : null,
  };
}

function buildResponse(
  answer: string,
  intent: AskIntent,
  confidence: number,
  contextUpdate: AskContext,
  usedContextRestaurant: boolean,
  usedContextHangout: boolean,
): AskResponsePayload {
  return {
    answer,
    meta: {
      intent,
      confidence,
      used_context: {
        restaurant: usedContextRestaurant,
        hangout: usedContextHangout,
      },
      context_update: contextUpdate,
    },
  };
}

async function findLastHangoutId(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
  restaurantId: string | null,
): Promise<string | null> {
  let query = service
    .from('receipt_uploads')
    .select('id')
    .eq('user_id', userId)
    .order('visited_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (restaurantId) {
    query = query.eq('restaurant_id', restaurantId);
  }

  const { data } = await query.maybeSingle();
  return data?.id ?? null;
}

async function resolveParams(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
  intent: AskIntent,
  context: AskContext,
  params: {
    restaurant_name: string | null;
    dish_keyword: string | null;
    timeframe_days: number | null;
    use_context_restaurant: boolean;
    use_context_hangout: boolean;
  },
): Promise<{ resolved: ResolvedParams; clarification: string | null }> {
  let restaurantName = params.restaurant_name;
  let usedContextRestaurant = false;

  if (!restaurantName && params.use_context_restaurant && context.lastRestaurantName) {
    restaurantName = context.lastRestaurantName;
    usedContextRestaurant = true;
  }

  let restaurantId: string | null = null;
  if (restaurantName) {
    const restaurant = await resolveRestaurantByName(service, userId, restaurantName);
    if (restaurant) {
      restaurantName = restaurant.name;
      restaurantId = restaurant.id;
    }
  }

  let hangoutId: string | null = null;
  let usedContextHangout = false;

  if (params.use_context_hangout && context.lastHangoutId) {
    hangoutId = context.lastHangoutId;
    usedContextHangout = true;
  }

  if (!hangoutId && intent === 'hangout_recap' && restaurantId) {
    hangoutId = await findLastHangoutId(service, userId, restaurantId);
  }

  const resolved: ResolvedParams = {
    restaurant_name: restaurantName,
    restaurant_id: restaurantId,
    dish_keyword: params.dish_keyword,
    timeframe_days: params.timeframe_days,
    hangout_id: hangoutId,
    used_context_restaurant: usedContextRestaurant,
    used_context_hangout: usedContextHangout,
  };

  if ((intent === 'last_hangout' || intent === 'dishes_at_restaurant') && !resolved.restaurant_name) {
    return { resolved, clarification: CLARIFICATION_RESTAURANT };
  }

  if (intent === 'hangout_recap' && !resolved.hangout_id) {
    return { resolved, clarification: CLARIFICATION_HANGOUT };
  }

  if (intent === 'cheapest_logged_item' && !resolved.dish_keyword) {
    return { resolved, clarification: "What dish should I check? Try something like 'cheapest chicken nuggets'." };
  }

  return { resolved, clarification: null };
}

export async function routeAsk(question: string, contextInput: Partial<AskContext> | null | undefined, userId: string): Promise<AskResponsePayload> {
  const service = getServiceSupabaseClient();
  const baseContext = toSafeContext(contextInput);

  const classification = await classifyQuestion(question, baseContext);

  if (!classification) {
    const fallback = mergeContext(baseContext, { lastIntent: 'unsupported' });
    return buildResponse(PARSE_FALLBACK_MESSAGE, 'unsupported', 0, fallback, false, false);
  }

  if (classification.intent === 'unsupported') {
    const updated = mergeContext(baseContext, { lastIntent: 'unsupported' });
    return buildResponse(UNSUPPORTED_MESSAGE, 'unsupported', classification.confidence, updated, false, false);
  }

  if (classification.needs_clarification) {
    const updated = mergeContext(baseContext, { lastIntent: classification.intent });
    return buildResponse(classification.clarification_question ?? PARSE_FALLBACK_MESSAGE, classification.intent, classification.confidence, updated, false, false);
  }

  const { resolved, clarification } = await resolveParams(service, userId, classification.intent, baseContext, classification.params);
  if (clarification) {
    const updated = mergeContext(baseContext, { lastIntent: classification.intent });
    return buildResponse(clarification, classification.intent, classification.confidence, updated, resolved.used_context_restaurant, resolved.used_context_hangout);
  }

  const handler = handlers[classification.intent];
  if (!handler) {
    const updated = mergeContext(baseContext, { lastIntent: 'unsupported' });
    return buildResponse(UNSUPPORTED_MESSAGE, 'unsupported', classification.confidence, updated, false, false);
  }

  const result = await handler({
    userId,
    service,
    params: resolved,
    context: baseContext,
  });

  const merged = mergeContext(baseContext, {
    ...result.context_update,
    lastIntent: classification.intent,
  });

  return buildResponse(
    result.answer,
    classification.intent,
    classification.confidence,
    merged,
    resolved.used_context_restaurant,
    resolved.used_context_hangout,
  );
}

export function normalizeAskContext(context: Partial<AskContext> | null | undefined): AskContext {
  return context ? toSafeContext(context) : DEFAULT_CONTEXT;
}
