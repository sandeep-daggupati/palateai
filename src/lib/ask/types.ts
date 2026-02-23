import { getServiceSupabaseClient } from '@/lib/supabase/server';

export type AskContext = {
  lastRestaurantName: string | null;
  lastRestaurantId: string | null;
  lastHangoutId: string | null;
  lastDishName: string | null;
  lastIntent: string | null;
};

export type AskRequestPayload = {
  question: string;
  context?: Partial<AskContext> | null;
};

export type AskIntent =
  | 'favorite_dish'
  | 'go_tos_lately'
  | 'last_hangout'
  | 'hangout_recap'
  | 'dishes_at_restaurant'
  | 'most_visited_restaurant'
  | 'identity_summary'
  | 'cheapest_logged_item'
  | 'unsupported';

export type ClassificationParams = {
  restaurant_name: string | null;
  dish_keyword: string | null;
  timeframe_days: number | null;
  use_context_restaurant: boolean;
  use_context_hangout: boolean;
};

export type Classification = {
  intent: AskIntent;
  confidence: number;
  params: ClassificationParams;
  needs_clarification: boolean;
  clarification_question: string | null;
};

export type AskResponsePayload = {
  answer: string;
  meta: {
    intent: AskIntent;
    confidence: number;
    used_context: {
      restaurant: boolean;
      hangout: boolean;
    };
    context_update: AskContext;
  };
};

export type ResolvedParams = {
  restaurant_name: string | null;
  restaurant_id: string | null;
  dish_keyword: string | null;
  timeframe_days: number | null;
  hangout_id: string | null;
  used_context_restaurant: boolean;
  used_context_hangout: boolean;
};

export type AskHandlerInput = {
  userId: string;
  service: ReturnType<typeof getServiceSupabaseClient>;
  params: ResolvedParams;
  context: AskContext;
};

export type AskHandlerOutput = {
  answer: string;
  context_update?: Partial<AskContext>;
};

export const DEFAULT_CONTEXT: AskContext = {
  lastRestaurantName: null,
  lastRestaurantId: null,
  lastHangoutId: null,
  lastDishName: null,
  lastIntent: null,
};

export const DEFAULT_CLASSIFICATION_PARAMS: ClassificationParams = {
  restaurant_name: null,
  dish_keyword: null,
  timeframe_days: null,
  use_context_restaurant: false,
  use_context_hangout: false,
};

export const UNSUPPORTED_MESSAGE =
  'I can answer questions about your PalateAI logs for now. Try asking about your favorite dish or last hangout.';

export const PARSE_FALLBACK_MESSAGE =
  'I had trouble understanding that. Try asking about your last hangout or GO-TO dishes.';

export const NO_DATA_MESSAGE = "I don't have that in your logs yet. Add a hangout and I'll learn.";

export const NO_PRICE_DATA_MESSAGE =
  "I don't have enough price data in your logs yet. Add a few priced hangouts and I'll get sharper.";

export const CLARIFICATION_HANGOUT = "Which hangout do you mean? Try: 'last hangout at Popeyes'.";
export const CLARIFICATION_RESTAURANT = 'Which restaurant should I check?';
