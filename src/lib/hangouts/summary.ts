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

type SummaryModelPayload = {
  summary_text: unknown;
  highlights?: unknown;
};

type HangoutSummary = TableRow<'hangout_summaries'>;

function toTitle(tag: string | null): string | null {
  if (!tag) return null;
  return tag
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function trimText(value: unknown, max = 220): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 3)}...`;
}

function parseSummaryPayload(payload: ResponsesOutput): { summary_text: string; highlights: string[] } | null {
  const jsonFromParts = payload.output?.flatMap((item) => item.content ?? []).find((part) => part.json && typeof part.json === 'object')
    ?.json;

  let parsed: SummaryModelPayload | null = null;

  if (jsonFromParts && typeof jsonFromParts === 'object') {
    parsed = jsonFromParts as SummaryModelPayload;
  } else {
    const textCandidate =
      (typeof payload.output_text === 'string' ? payload.output_text : null) ??
      (payload.output?.flatMap((item) => item.content ?? []).find((part) => typeof part.text === 'string')?.text as string | undefined) ??
      null;

    if (!textCandidate) return null;
    try {
      parsed = JSON.parse(textCandidate) as SummaryModelPayload;
    } catch {
      const start = textCandidate.indexOf('{');
      const end = textCandidate.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try {
        parsed = JSON.parse(textCandidate.slice(start, end + 1)) as SummaryModelPayload;
      } catch {
        return null;
      }
    }
  }

  if (!parsed) return null;
  const summaryText = trimText(parsed.summary_text, 240);
  if (!summaryText) return null;

  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights
        .map((entry) => trimText(entry, 80))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 4)
    : [];

  return {
    summary_text: summaryText,
    highlights,
  };
}

async function phraseSummaryWithOpenAI(input: {
  restaurantName: string | null;
  occurredAt: string;
  hangoutNote: string | null;
  crewNames: string[];
  dishSignals: Array<{
    dish_name: string;
    identity_tag: string | null;
    note: string | null;
  }>;
}): Promise<{ summary_text: string; highlights: string[] } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You write memory-first food hangout recaps.
Return strict JSON only:
{"summary_text":"...","highlights":["..."]}
Rules:
- summary_text must be one concise sentence, max 200 chars.
- Keep tone warm and specific.
- Mention 1-2 meaningful dish moments.
- Do not include sensitive personal details.
- highlights is optional short bullet text snippets (0-4), each max 70 chars.`;

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
        { role: 'system', content: [{ type: 'input_text', text: prompt }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'hangout_summary',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary_text', 'highlights'],
            properties: {
              summary_text: { type: 'string' },
              highlights: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as ResponsesOutput;
  return parseSummaryPayload(payload);
}

function fallbackSummary(input: {
  restaurantName: string | null;
  occurredAt: string;
  dishSignals: Array<{
    dish_name: string;
    identity_tag: string | null;
    note: string | null;
  }>;
}): { summary_text: string; highlights: string[] } {
  const restaurant = input.restaurantName ?? 'this spot';
  const top = input.dishSignals[0];
  if (top) {
    const identity = toTitle(top.identity_tag);
    if (identity) {
      return {
        summary_text: `${formatDate(input.occurredAt)} at ${restaurant} centered on ${top.dish_name}, tagged as ${identity}.`,
        highlights: [],
      };
    }

    return {
      summary_text: `${formatDate(input.occurredAt)} at ${restaurant} featured ${top.dish_name} as a standout memory.`,
      highlights: [],
    };
  }

  return {
    summary_text: `${formatDate(input.occurredAt)} at ${restaurant} is saved as one of your recent food memories.`,
    highlights: [],
  };
}

export async function getOrCreateHangoutSummary(hangoutId: string, viewerUserId: string): Promise<HangoutSummary | null> {
  const service = getServiceSupabaseClient();

  const { data: hangout } = await service
    .from('hangouts')
    .select('id,owner_user_id,restaurant_id,occurred_at,note')
    .eq('id', hangoutId)
    .maybeSingle();

  if (!hangout) return null;

  const isOwner = hangout.owner_user_id === viewerUserId;
  if (!isOwner) {
    const { data: participant } = await service
      .from('hangout_participants')
      .select('hangout_id')
      .eq('hangout_id', hangoutId)
      .eq('user_id', viewerUserId)
      .maybeSingle();

    if (!participant) return null;
  }

  const { data: cached } = await service.from('hangout_summaries').select('*').eq('hangout_id', hangoutId).maybeSingle();
  if (cached) return cached as HangoutSummary;

  const [{ data: restaurant }, { data: entries }, { data: participants }] = await Promise.all([
    hangout.restaurant_id ? service.from('restaurants').select('name').eq('id', hangout.restaurant_id).maybeSingle() : Promise.resolve({ data: null }),
    service
      .from('dish_entries')
      .select('dish_name,identity_tag,comment,created_at')
      .eq('hangout_id', hangoutId)
      .order('created_at', { ascending: true })
      .limit(30),
    service.from('hangout_participants').select('user_id').eq('hangout_id', hangoutId).limit(12),
  ]);

  let crewNames: string[] = [];
  if (isOwner && participants && participants.length > 0) {
    const ids = participants.map((row) => row.user_id).filter(Boolean);
    if (ids.length > 0) {
      const { data: profiles } = await service.from('profiles').select('id,display_name').in('id', ids);
      crewNames = (profiles ?? [])
        .map((profile) => profile.display_name?.trim() ?? null)
        .filter((name): name is string => Boolean(name))
        .slice(0, 5);
    }
  }

  const dishSignals = ((entries ?? []) as Array<{ dish_name: string; identity_tag: string | null; comment: string | null }>)
    .map((entry) => ({
      dish_name: entry.dish_name,
      identity_tag: entry.identity_tag,
      note: trimText(entry.comment, 120),
    }))
    .slice(0, 12);

  const promptInput = {
    restaurantName: restaurant?.name ?? null,
    occurredAt: hangout.occurred_at,
    hangoutNote: trimText(hangout.note, 140),
    crewNames,
    dishSignals,
  };

  const ai = await phraseSummaryWithOpenAI(promptInput);
  const fallback = fallbackSummary(promptInput);
  const generated = ai ?? fallback;

  const metadata = {
    restaurant_name: restaurant?.name ?? null,
    occurred_at: hangout.occurred_at,
    crew_names_included: crewNames.length > 0,
    highlights: generated.highlights,
    source: ai ? 'openai' : 'fallback',
  };

  const payload: TableInsert<'hangout_summaries'> = {
    hangout_id: hangoutId,
    summary_text: generated.summary_text,
    metadata: metadata as Json,
    generated_at: new Date().toISOString(),
  };

  const { data, error } = await service
    .from('hangout_summaries')
    .upsert(payload, { onConflict: 'hangout_id' })
    .select('*')
    .single();

  if (error || !data) {
    return {
      hangout_id: hangoutId,
      summary_text: generated.summary_text,
      metadata: metadata as Json,
      generated_at: new Date().toISOString(),
    };
  }

  return data as HangoutSummary;
}
