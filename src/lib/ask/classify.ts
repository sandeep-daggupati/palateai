import { AskContext, AskIntent, Classification, DEFAULT_CLASSIFICATION_PARAMS } from '@/lib/ask/types';

const ALLOWED_INTENTS: AskIntent[] = [
  'favorite_dish',
  'go_tos_lately',
  'last_hangout',
  'hangout_recap',
  'dishes_at_restaurant',
  'most_visited_restaurant',
  'identity_summary',
  'cheapest_logged_item',
  'unsupported',
];

function parseRestaurantName(question: string): string | null {
  const direct = question.match(/\bat\s+([a-z0-9 '&.-]{2,})/i)?.[1]?.trim();
  if (direct) return direct;

  const withLast = question.match(/last\s+hangout\s+(?:in|at)\s+([a-z0-9 '&.-]{2,})/i)?.[1]?.trim();
  return withLast ?? null;
}

function parseTimeframeDays(question: string): number | null {
  const days = question.match(/(\d+)\s*day/i)?.[1];
  if (!days) return null;

  const parsed = Number(days);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseDishKeyword(question: string): string | null {
  const q = question.toLowerCase();
  if (!q.includes('cheap') && !q.includes('cheapest')) return null;

  let cleaned = q;
  cleaned = cleaned.replace(/where can i find/gi, '');
  cleaned = cleaned.replace(/what('?s| is) the/gi, '');
  cleaned = cleaned.replace(/\bfor cheap\b|\bcheapest\b|\bcheap\b|\bprice\b|\blogged\b|\bitem\b|\bin my logs\b/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned.length > 1 ? cleaned : null;
}

function normalizeIntent(value: unknown): AskIntent {
  if (typeof value !== 'string') return 'unsupported';
  return (ALLOWED_INTENTS.includes(value as AskIntent) ? value : 'unsupported') as AskIntent;
}

function validateClassification(raw: unknown): Classification | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;

  const paramsRaw = src.params;
  if (!paramsRaw || typeof paramsRaw !== 'object') return null;
  const paramsObj = paramsRaw as Record<string, unknown>;

  const timeframe = typeof paramsObj.timeframe_days === 'number' && Number.isFinite(paramsObj.timeframe_days) ? paramsObj.timeframe_days : null;

  const classification: Classification = {
    intent: normalizeIntent(src.intent),
    confidence: typeof src.confidence === 'number' && Number.isFinite(src.confidence) ? Math.max(0, Math.min(1, src.confidence)) : 0.5,
    params: {
      restaurant_name: typeof paramsObj.restaurant_name === 'string' && paramsObj.restaurant_name.trim().length > 0 ? paramsObj.restaurant_name.trim() : null,
      dish_keyword: typeof paramsObj.dish_keyword === 'string' && paramsObj.dish_keyword.trim().length > 0 ? paramsObj.dish_keyword.trim() : null,
      timeframe_days: timeframe,
      use_context_restaurant: paramsObj.use_context_restaurant === true,
      use_context_hangout: paramsObj.use_context_hangout === true,
    },
    needs_clarification: src.needs_clarification === true,
    clarification_question: typeof src.clarification_question === 'string' && src.clarification_question.trim().length > 0 ? src.clarification_question.trim() : null,
  };

  return classification;
}

export function classifyHeuristic(question: string): Classification {
  const q = question.toLowerCase();
  const restaurantName = parseRestaurantName(question);
  const timeframeDays = parseTimeframeDays(question);

  if (q.includes('favorite')) {
    return {
      intent: 'favorite_dish',
      confidence: 0.72,
      params: { ...DEFAULT_CLASSIFICATION_PARAMS },
      needs_clarification: false,
      clarification_question: null,
    };
  }

  if (q.includes('go-to') || q.includes('go to') || q.includes('lately')) {
    return {
      intent: 'go_tos_lately',
      confidence: 0.8,
      params: { ...DEFAULT_CLASSIFICATION_PARAMS, timeframe_days: timeframeDays },
      needs_clarification: false,
      clarification_question: null,
    };
  }

  if (q.includes('last hangout')) {
    return {
      intent: 'last_hangout',
      confidence: 0.84,
      params: {
        ...DEFAULT_CLASSIFICATION_PARAMS,
        restaurant_name: restaurantName,
        use_context_restaurant: !restaurantName,
      },
      needs_clarification: false,
      clarification_question: null,
    };
  }

  if (q.includes('recap') || q.includes('what did i order') || q.includes('what did i have')) {
    return {
      intent: 'hangout_recap',
      confidence: 0.8,
      params: {
        ...DEFAULT_CLASSIFICATION_PARAMS,
        restaurant_name: restaurantName,
        use_context_hangout: true,
        use_context_restaurant: !restaurantName,
      },
      needs_clarification: false,
      clarification_question: null,
    };
  }

  if ((q.includes('dishes') || q.includes('order')) && (restaurantName || q.includes('there') || q.includes('that place'))) {
    return {
      intent: 'dishes_at_restaurant',
      confidence: 0.76,
      params: {
        ...DEFAULT_CLASSIFICATION_PARAMS,
        restaurant_name: restaurantName,
        use_context_restaurant: !restaurantName,
      },
      needs_clarification: false,
      clarification_question: null,
    };
  }

  if (q.includes('most visited')) {
    return {
      intent: 'most_visited_restaurant',
      confidence: 0.82,
      params: { ...DEFAULT_CLASSIFICATION_PARAMS, timeframe_days: timeframeDays },
      needs_clarification: false,
      clarification_question: null,
    };
  }

  if (q.includes('identity') || q.includes('summary')) {
    return {
      intent: 'identity_summary',
      confidence: 0.74,
      params: { ...DEFAULT_CLASSIFICATION_PARAMS, timeframe_days: timeframeDays },
      needs_clarification: false,
      clarification_question: null,
    };
  }

  if (q.includes('cheap') || q.includes('cheapest')) {
    return {
      intent: 'cheapest_logged_item',
      confidence: 0.79,
      params: {
        ...DEFAULT_CLASSIFICATION_PARAMS,
        restaurant_name: restaurantName,
        dish_keyword: parseDishKeyword(question),
        use_context_restaurant: !restaurantName && (q.includes('there') || q.includes('that place')),
      },
      needs_clarification: false,
      clarification_question: null,
    };
  }

  return {
    intent: 'unsupported',
    confidence: 0.62,
    params: { ...DEFAULT_CLASSIFICATION_PARAMS },
    needs_clarification: false,
    clarification_question: null,
  };
}

export async function classifyQuestion(question: string, context: AskContext): Promise<Classification | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return classifyHeuristic(question);

  const prompt = `You are an intent classifier for a personal food-log app named PalateAI.
Return JSON ONLY. No markdown. No explanations.

Schema:
{
  "intent": "favorite_dish | go_tos_lately | last_hangout | hangout_recap | dishes_at_restaurant | most_visited_restaurant | identity_summary | cheapest_logged_item | unsupported",
  "confidence": number,
  "params": {
    "restaurant_name": string|null,
    "dish_keyword": string|null,
    "timeframe_days": number|null,
    "use_context_restaurant": boolean,
    "use_context_hangout": boolean
  },
  "needs_clarification": boolean,
  "clarification_question": string|null
}

Rules:
- Questions are ONLY about the user's own PalateAI logs.
- If restaurant is implied (there, that place, last time), set use_context_restaurant=true.
- If hangout is implied (what did I order, recap), set use_context_hangout=true.
- If required info is missing and context may not resolve it, set needs_clarification=true with one short clarification question.

Question: ${question}
Context: ${JSON.stringify(context)}`;

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

    if (!response.ok) return classifyHeuristic(question);

    const payload = (await response.json()) as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ text?: unknown }> }>;
    };

    const outputText = typeof payload.output_text === 'string' ? payload.output_text : null;
    const fromParts = payload.output?.flatMap((item) => item.content ?? []).find((part) => typeof part.text === 'string')?.text;
    const text = outputText ?? (typeof fromParts === 'string' ? fromParts : null);
    if (!text) return null;

    const parsed = JSON.parse(text) as unknown;
    return validateClassification(parsed);
  } catch {
    return classifyHeuristic(question);
  }
}
