import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { Json, TableInsert, TableRow } from '@/lib/supabase/types';

type ResponsesOutput = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      text?: unknown;
      json?: unknown;
    }>;
  }>;
};

type CaptionModelPayload = {
  options?: unknown;
};

type CaptionSource = 'openai' | 'user' | 'fallback';

type CaptionRecord = TableRow<'hangout_summaries'>;

type CaptionContext = {
  hangoutId: string;
  restaurantName: string | null;
  foods: string[];
  cuisine: string | null;
  flavors: string[];
  vibeTags: string[];
  crewSize: number;
  overallVibe: string | null;
};

const BANNED_PHRASES = [
  'cozy evening',
  'laughter',
  'conversation',
  'together',
  'memorable night',
  'date night',
  'friends',
] as const;

const SOLO_OTHER_PEOPLE_PATTERN = /\b(and i|we|our|us|together|friends|crew|budd(y|ies)|with\s+[a-z]+\s+and\s+[a-z]+)\b/i;

function trimText(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 3)}...`;
}

function normalizeWord(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeArray(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (value ?? '').trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function includesAny(text: string, values: string[]): boolean {
  const lower = normalizeWord(text);
  return values.some((value) => {
    const candidate = normalizeWord(value);
    if (!candidate) return false;
    if (lower.includes(candidate)) return true;

    const firstWord = candidate.split(/\s+/)[0] ?? '';
    return firstWord.length >= 4 ? lower.includes(firstWord) : false;
  });
}

function scoreCaption(caption: string, context: CaptionContext): number {
  let score = 0;
  const lower = normalizeWord(caption);

  if (context.foods.length > 0 && includesAny(lower, [context.foods[0], ...context.foods])) {
    score += 2;
  }

  if (context.restaurantName && includesAny(lower, [context.restaurantName])) {
    score += 2;
  }

  const flavorOrCuisine = [...context.flavors, context.cuisine].filter((value): value is string => Boolean(value));
  if (flavorOrCuisine.length > 0 && includesAny(lower, flavorOrCuisine)) {
    score += 1;
  }

  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      score -= 3;
      break;
    }
  }

  if (context.crewSize === 1 && SOLO_OTHER_PEOPLE_PATTERN.test(caption)) {
    score -= 3;
  }

  return score;
}

function bestCaption(options: string[], context: CaptionContext): string | null {
  if (options.length === 0) return null;

  let best: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const option of options) {
    const score = scoreCaption(option, context);
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }

  return best;
}

function fallbackCaption(context: CaptionContext): string {
  const restaurant = context.restaurantName ?? 'Restaurant not detected';
  const food = context.foods[0] ?? 'a dish';
  if (context.cuisine) {
    return `${food} at ${restaurant}. ${context.cuisine} logged.`;
  }
  return `${food} at ${restaurant}.`;
}

function parseCaptionPayload(payload: ResponsesOutput): string[] {
  const jsonFromParts = payload.output?.flatMap((item) => item.content ?? []).find((part) => part.json && typeof part.json === 'object')
    ?.json;

  let parsed: CaptionModelPayload | null = null;

  if (jsonFromParts && typeof jsonFromParts === 'object') {
    parsed = jsonFromParts as CaptionModelPayload;
  } else {
    const textCandidate =
      (typeof payload.output_text === 'string' ? payload.output_text : null) ??
      (payload.output?.flatMap((item) => item.content ?? []).find((part) => typeof part.text === 'string')?.text as string | undefined) ??
      null;

    if (!textCandidate) return [];
    try {
      parsed = JSON.parse(textCandidate) as CaptionModelPayload;
    } catch {
      const start = textCandidate.indexOf('{');
      const end = textCandidate.lastIndexOf('}');
      if (start < 0 || end <= start) return [];
      try {
        parsed = JSON.parse(textCandidate.slice(start, end + 1)) as CaptionModelPayload;
      } catch {
        return [];
      }
    }
  }

  if (!parsed || !Array.isArray(parsed.options)) return [];
  const cleaned = parsed.options
    .map((entry) => trimText(entry, 160))
    .filter((entry): entry is string => Boolean(entry));

  return cleaned.slice(0, 3);
}

async function generateCaptionOptions(context: CaptionContext): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const rules = [
    'Use only the JSON fields provided.',
    'If crew_size is 1, do NOT mention other people.',
    'Do NOT include: cozy, laughter, conversation, together, memorable, date night, friends (unless crew_size>1).',
    '1-2 sentences. Max 160 characters.',
    'Mention restaurant and at least one food if available.',
    "If overall_vibe is present, you may reflect it briefly, but don't add new facts.",
    'Return format:',
    '{"options":["...","...","..."]}',
  ].join('\n');

  const modelInput = {
    restaurant_name: context.restaurantName,
    foods: context.foods,
    cuisine: context.cuisine,
    flavors: context.flavors,
    vibe_tags: context.vibeTags,
    crew_size: context.crewSize,
    overall_vibe: context.overallVibe,
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: 'You write short, factual captions for a private food log app. Do not invent details.' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: `${rules}\nJSON input:\n${JSON.stringify(modelInput)}` }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'caption_options',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['options'],
            properties: {
              options: {
                type: 'array',
                minItems: 3,
                maxItems: 3,
                items: { type: 'string' },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) return [];
  const payload = (await response.json()) as ResponsesOutput;
  return parseCaptionPayload(payload);
}

export async function canUserAccessHangout(hangoutId: string, userId: string): Promise<boolean> {
  const service = getServiceSupabaseClient();
  const { data: hangout } = await service.from('hangouts').select('id,owner_user_id').eq('id', hangoutId).maybeSingle();
  if (!hangout) return false;
  if (hangout.owner_user_id === userId) return true;

  const { data: participant } = await service
    .from('hangout_participants')
    .select('hangout_id')
    .eq('hangout_id', hangoutId)
    .eq('user_id', userId)
    .maybeSingle();

  return Boolean(participant);
}

export async function getExistingHangoutCaption(hangoutId: string): Promise<CaptionRecord | null> {
  const service = getServiceSupabaseClient();
  const { data } = await service.from('hangout_summaries').select('*').eq('hangout_id', hangoutId).maybeSingle();
  return (data as CaptionRecord | null) ?? null;
}

async function buildCaptionContext(
  hangoutId: string,
  overrides?: { vibeTags?: string[]; overallVibe?: string | null },
): Promise<CaptionContext | null> {
  const service = getServiceSupabaseClient();

  const { data: hangout } = await service
    .from('hangouts')
    .select('id,restaurant_id,note,owner_user_id')
    .eq('id', hangoutId)
    .maybeSingle();

  if (!hangout) return null;

  const [{ data: restaurant }, { data: items }, { data: entries }, { data: participants }, { data: upload }] = await Promise.all([
    hangout.restaurant_id ? service.from('restaurants').select('name').eq('id', hangout.restaurant_id).maybeSingle() : Promise.resolve({ data: null }),
    service.from('hangout_items').select('name_raw,name_final,included').eq('hangout_id', hangoutId).eq('included', true).order('created_at', { ascending: true }),
    service.from('dish_entries').select('cuisine,flavor_tags').eq('hangout_id', hangoutId).limit(50),
    service.from('hangout_participants').select('user_id').eq('hangout_id', hangoutId).limit(30),
    service.from('receipt_uploads').select('vibe_tags,visit_note').eq('id', hangoutId).maybeSingle(),
  ]);

  const foods = normalizeArray(
    (items ?? []).map((row) => (row.name_final?.trim() ? row.name_final : row.name_raw)).filter((value): value is string => Boolean(value)),
  ).slice(0, 8);

  const cuisines = normalizeArray((entries ?? []).map((row) => row.cuisine));
  const flavors = normalizeArray((entries ?? []).flatMap((row) => (Array.isArray(row.flavor_tags) ? row.flavor_tags : []))).slice(0, 8);

  const activeParticipantIds = new Set(
    (participants ?? [])
      .map((row) => row.user_id)
      .filter((value): value is string => Boolean(value)),
  );
  activeParticipantIds.add(hangout.owner_user_id);

  const derivedVibeTags = normalizeArray(
    (Array.isArray(upload?.vibe_tags) ? upload.vibe_tags : []).map((value) => (typeof value === 'string' ? value : null)),
  );
  const overrideVibeTags = normalizeArray((overrides?.vibeTags ?? []).map((value) => value));
  const vibeTags = overrideVibeTags.length > 0 ? overrideVibeTags : derivedVibeTags;

  const overrideVibe = trimText(overrides?.overallVibe ?? null, 120);
  const uploadVibe = trimText(upload?.visit_note ?? null, 120);

  return {
    hangoutId,
    restaurantName: restaurant?.name?.trim() || null,
    foods,
    cuisine: cuisines[0] ?? null,
    flavors,
    vibeTags,
    crewSize: Math.max(activeParticipantIds.size, 1),
    overallVibe: overrideVibe ?? uploadVibe ?? trimText(hangout.note, 120),
  };
}

export async function saveUserCaption(hangoutId: string, captionText: string): Promise<CaptionRecord> {
  const service = getServiceSupabaseClient();
  const cleaned = trimText(captionText, 160);
  if (!cleaned) {
    throw new Error('Caption cannot be empty');
  }

  const payload: TableInsert<'hangout_summaries'> = {
    hangout_id: hangoutId,
    summary_text: cleaned,
    caption_text: cleaned,
    caption_source: 'user',
    caption_generated_at: new Date().toISOString(),
    caption_options: null,
    metadata: {
      mode: 'manual_override',
    } as Json,
  };

  const { data, error } = await service.from('hangout_summaries').upsert(payload, { onConflict: 'hangout_id' }).select('*').single();
  if (error) throw error;
  return data as CaptionRecord;
}

export async function generateAndSaveHangoutCaption(
  hangoutId: string,
  options?: { force?: boolean; vibeTags?: string[]; overallVibe?: string | null },
): Promise<CaptionRecord | null> {
  const force = options?.force === true;
  const service = getServiceSupabaseClient();

  const existing = await getExistingHangoutCaption(hangoutId);
  if (!force && existing?.caption_source === 'user' && existing.caption_text) {
    return existing;
  }

  const context = await buildCaptionContext(hangoutId, {
    vibeTags: options?.vibeTags,
    overallVibe: options?.overallVibe,
  });
  if (!context) return null;

  const optionCandidates = await generateCaptionOptions(context);
  const best = bestCaption(optionCandidates, context);

  const finalCaption = trimText(best, 160) ?? trimText(fallbackCaption(context), 160);
  if (!finalCaption) return null;

  const source: CaptionSource = optionCandidates.length > 0 ? 'openai' : 'fallback';

  const payload: TableInsert<'hangout_summaries'> = {
    hangout_id: hangoutId,
    summary_text: finalCaption,
    caption_text: finalCaption,
    caption_source: source,
    caption_generated_at: new Date().toISOString(),
    caption_options: optionCandidates as unknown as Json,
    generated_at: new Date().toISOString(),
    metadata: {
      mode: force ? 'regenerate' : 'save',
      restaurant_name: context.restaurantName,
      crew_size: context.crewSize,
      foods_used: context.foods,
      vibe_tags: context.vibeTags,
    } as Json,
  };

  const { data, error } = await service.from('hangout_summaries').upsert(payload, { onConflict: 'hangout_id' }).select('*').single();
  if (error) throw error;
  return data as CaptionRecord;
}
