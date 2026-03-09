import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { TableInsert, TableRow } from '@/lib/supabase/types';
import { sanitizeText } from '@/lib/text/sanitize';

type ResponsesOutput = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      type?: unknown;
      text?: unknown;
      json?: unknown;
    }>;
  }>;
};

type DishCatalogModelPayload = {
  name_canonical: unknown;
  description: unknown;
  cuisine: unknown;
  flavor_tags: unknown;
};

const DISH_CATALOG_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name_canonical', 'description', 'cuisine', 'flavor_tags'],
  properties: {
    name_canonical: { type: 'string' },
    description: { type: ['string', 'null'] },
    cuisine: { type: ['string', 'null'] },
    flavor_tags: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },
  },
} as const;

const DISH_CATALOG_PROMPT = `You generate concise dish-catalog metadata for a food logging app.
Return JSON only.

Rules:
- Keep name_canonical specific but short (2-60 chars).
- description should be one sentence, under 180 chars, consumer-friendly.
- cuisine should be a single cuisine label or null.
- flavor_tags should include 0-6 lowercase tags (examples: savory, spicy, creamy, smoky, citrusy, crispy).
- Do not include markdown.
- If uncertain, prefer null/empty tags over guessing.`;

function truncate(value: string, max = 220): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function sanitizeString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = sanitizeText(value);
  if (!cleaned) return null;
  return cleaned.slice(0, maxLen);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function toTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseModelOutput(data: ResponsesOutput): DishCatalogModelPayload {
  const jsonPart = data.output?.flatMap((entry) => entry.content ?? []).find((part) => part.json && typeof part.json === 'object')?.json;
  if (jsonPart && typeof jsonPart === 'object') {
    return jsonPart as DishCatalogModelPayload;
  }

  const text =
    (typeof data.output_text === 'string' && data.output_text.trim().length > 0
      ? data.output_text
      : data.output?.flatMap((entry) => entry.content ?? []).find((part) => typeof part.text === 'string')?.text) ?? null;

  if (typeof text !== 'string') {
    throw new Error('OpenAI returned no catalog payload');
  }

  try {
    return JSON.parse(text) as DishCatalogModelPayload;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as DishCatalogModelPayload;
    }
    throw new Error('OpenAI returned invalid catalog JSON');
  }
}

function validateCatalogPayload(raw: DishCatalogModelPayload, dishName: string): Omit<TableInsert<'dish_catalog'>, 'dish_key'> {
  const nameCanonicalRaw = sanitizeString(raw.name_canonical, 60) ?? dishName;
  const description = sanitizeString(raw.description, 180);
  const cuisine = sanitizeString(raw.cuisine, 60);

  const tagSet = new Set<string>();
  if (Array.isArray(raw.flavor_tags)) {
    for (const tag of raw.flavor_tags) {
      if (typeof tag !== 'string') continue;
      const normalized = toTag(tag);
      if (!normalized) continue;
      tagSet.add(normalized);
      if (tagSet.size >= 6) break;
    }
  }

  return {
    name_canonical: titleCase(nameCanonicalRaw),
    description,
    cuisine: cuisine ? titleCase(cuisine) : null,
    flavor_tags: tagSet.size > 0 ? Array.from(tagSet) : null,
    generated_at: new Date().toISOString(),
  };
}

async function generateDishCatalogWithOpenAI(params: {
  dishKey: string;
  dishName: string;
  restaurantName: string | null;
}): Promise<Omit<TableInsert<'dish_catalog'>, 'dish_key'>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const context = {
    dish_key: params.dishKey,
    dish_name: params.dishName,
    restaurant_name: params.restaurantName,
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: DISH_CATALOG_PROMPT }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify(context) }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'dish_catalog_metadata',
          schema: DISH_CATALOG_JSON_SCHEMA,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI catalog generation failed (${response.status}): ${truncate(body)}`);
  }

  const payload = (await response.json()) as ResponsesOutput;
  const parsed = parseModelOutput(payload);
  return validateCatalogPayload(parsed, params.dishName);
}

export async function ensureDishCatalogEntry(params: {
  dishKey: string;
  dishName: string;
  restaurantName?: string | null;
}): Promise<TableRow<'dish_catalog'> | null> {
  const dishKey = sanitizeText(params.dishKey).trim();
  const dishName = sanitizeText(params.dishName).trim();
  if (!dishKey || !dishName) return null;

  const supabase = getServiceSupabaseClient();

  const { data: existingData } = await supabase
    .from('dish_catalog')
    .select('*')
    .eq('dish_key', dishKey)
    .maybeSingle();
  const existing = (existingData ?? null) as TableRow<'dish_catalog'> | null;

  if (existing && existing.description) {
    return existing as TableRow<'dish_catalog'>;
  }

  const generated = await generateDishCatalogWithOpenAI({
    dishKey,
    dishName,
    restaurantName: params.restaurantName ?? null,
  });

  const payload: TableInsert<'dish_catalog'> = {
    dish_key: dishKey,
    ...generated,
  };

  const { data, error } = await supabase.from('dish_catalog').upsert(payload, { onConflict: 'dish_key' }).select('*').single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to upsert dish catalog entry');
  }

  return data as TableRow<'dish_catalog'>;
}


