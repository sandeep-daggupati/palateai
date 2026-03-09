// src/lib/extraction/openaiVision.ts
import { sanitizeNullableText, sanitizeText } from '@/lib/text/sanitize';
type Extracted = {
  items: Array<{ name: string; price: number }>;
  currency: string | null;
  notes: string | null;
  merchant: {
    name: string | null;
    address: string | null;
    phone: string | null;
  };
  datetime: string | null;
};

type ParsedItem = {
  name?: unknown;
  price?: unknown;
};

type ParsedResponse = {
  items?: ParsedItem[];
  currency?: unknown;
  notes?: unknown;
  merchant?: {
    name?: unknown;
    address?: unknown;
    phone?: unknown;
  };
  datetime?: unknown;
};

type NameRepair = {
  raw_name?: unknown;
  repaired_name?: unknown;
  confidence?: unknown;
};

type ParsedNameRepair = {
  items?: NameRepair[];
};

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

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function getResponseText(data: ResponsesOutput): string | null {
  if (typeof data.output_text === "string" && data.output_text.trim().length > 0) {
    return data.output_text;
  }

  const content = data.output?.flatMap((entry) => entry.content ?? []) ?? [];
  for (const part of content) {
    if (typeof part.text === "string" && part.text.trim().length > 0) {
      return part.text;
    }

    if (part.json && typeof part.json === "object") {
      return JSON.stringify(part.json);
    }
  }

  return null;
}

function parseModelJson<T>(modelText: string): T {
  try {
    return JSON.parse(modelText) as T;
  } catch {
    const start = modelText.indexOf("{");
    const end = modelText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(modelText.slice(start, end + 1)) as T;
    }

    throw new Error("OpenAI response did not contain valid JSON output");
  }
}

function truncate(value: string, max = 220): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function toNaiveDateTime(year: number, month: number, day: number, hour: number, minute: number, second = 0): string | null {
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function parseReceiptDateTime(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;

  const isoMatch = cleaned.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (isoMatch) {
    let hour = Number(isoMatch[4]);
    const minute = Number(isoMatch[5]);
    const second = Number(isoMatch[6] ?? '0');
    const meridiem = isoMatch[7]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return toNaiveDateTime(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]), hour, minute, second);
  }

  const usMatch = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    const rawYear = Number(usMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    let hour = Number(usMatch[4]);
    const minute = Number(usMatch[5]);
    const second = Number(usMatch[6] ?? '0');
    const meridiem = usMatch[7]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return toNaiveDateTime(year, month, day, hour, minute, second);
  }

  return null;
}

function redactImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

async function callJsonResponse(params: {
  traceId: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params.payload),
  });

  console.info(`[extract:${params.traceId}] openai.response`, {
    status: resp.status,
    ok: resp.ok,
  });

  if (!resp.ok) {
    const msg = await resp.text();
    console.error(`[extract:${params.traceId}] openai.httpError`, {
      status: resp.status,
      body: truncate(msg),
    });
    throw new Error(`OpenAI error ${resp.status}: ${msg}`);
  }

  const data = (await resp.json()) as ResponsesOutput;
  const modelText = getResponseText(data);

  if (!modelText) {
    throw new Error("OpenAI returned no parseable text output");
  }

  return modelText;
}

export async function extractLineItemsFromImage(params: {
  imageUrl: string; // signed URL
  traceId?: string;
}): Promise<Extracted> {
  const traceId = params.traceId ?? "no-trace";
  const apiKey = process.env.OPENAI_API_KEY;

  console.info(`[extract:${traceId}] openaiVision.start`, {
    hasApiKey: Boolean(apiKey),
    imageUrl: redactImageUrl(params.imageUrl),
  });

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const instructions = `
You extract restaurant menu/receipt LINE ITEMS and PRICES.

Return ONLY valid JSON in this exact shape:
{
  "merchant": {"name": string|null, "address": string|null, "phone": string|null},
  "datetime": string|null,
  "items": [{"name": string, "price": number}],
  "currency": string|null,
  "notes": string|null
}

Rules:
- Include only purchased menu items (dish/drink names) with their item prices.
- Ignore totals, subtotal, tax, tip, service fee, discounts, coupons, payment lines, change, tender, order IDs.
- merchant fields are optional; return null when missing.
- datetime should be transaction timestamp if visible. Prefer timestamps near APPROVED, PURCHASE, TOTAL, AMOUNT, CARD, AUTH.
- detect common formats: MM/DD/YYYY HH:MM, MM/DD/YY HH:MM, YYYY-MM-DD HH:MM, HH:MM AM/PM.
- return datetime as "YYYY-MM-DDTHH:MM:SS" (24h, no timezone) when date+time are confidently found; else null.
- If quantity appears (e.g. 2x), still return a single item name; price should be the line price shown.
- "price" must be a number like 15.95 (no currency symbols).
- Keep names as printed but trim whitespace.`;

  const modelText = await callJsonResponse({
    traceId,
    payload: {
      model: "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instructions },
            { type: "input_image", image_url: params.imageUrl },
          ],
        },
      ],
      text: { format: { type: "json_object" } },
    },
  });

  console.info(`[extract:${traceId}] openaiVision.payload`, {
    hasModelText: Boolean(modelText),
    modelTextPreview: truncate(modelText, 180),
  });

  const parsed = parseModelJson<ParsedResponse>(modelText);

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const cleaned: Extracted["items"] = [];

  for (const it of items) {
    const name = sanitizeText(it.name);
    const price = it.price;

    if (!name || name.length > 120) continue;
    if (!isFiniteNumber(price)) continue;
    if (price <= 0 || price > 500) continue;

    cleaned.push({ name, price: Math.round(price * 100) / 100 });
  }

  console.info(`[extract:${traceId}] openaiVision.cleaned`, {
    parsedItems: items.length,
    keptItems: cleaned.length,
    currency: sanitizeNullableText(parsed.currency),
  });

  return {
    items: cleaned,
    currency: sanitizeNullableText(parsed.currency),
    notes: sanitizeNullableText(parsed.notes),
    merchant: {
      name: sanitizeNullableText(parsed.merchant?.name),
      address: sanitizeNullableText(parsed.merchant?.address),
      phone: sanitizeNullableText(parsed.merchant?.phone),
    },
    datetime: parseReceiptDateTime(typeof parsed.datetime === "string" ? parsed.datetime : null),
  };
}

export async function repairLineItemNamesText(params: {
  traceId?: string;
  flaggedRawNames: string[];
  restaurantContext: string | null;
  allNames: string[];
}): Promise<Array<{ raw_name: string; repaired_name: string; confidence: number }>> {
  if (params.flaggedRawNames.length === 0) return [];

  const traceId = params.traceId ?? "no-trace";

  const contextBlock = params.restaurantContext ? `Restaurant context: ${params.restaurantContext}` : "Restaurant context: unknown";
  const allNamesBlock = params.allNames.length > 0 ? params.allNames.join("\n") : "none";
  const flaggedBlock = params.flaggedRawNames.join("\n");

  const instructions = `
Repair abbreviated/truncated restaurant line-item names.

Return ONLY JSON:
{
  "items": [
    {"raw_name": string, "repaired_name": string, "confidence": number}
  ]
}

Rules:
- Input list is authoritative. Do not invent or add items.
- Keep repaired_name semantically close to raw_name.
- Use title case for repaired_name.
- If unsure, keep repaired_name same as raw_name and set low confidence.
- confidence must be between 0 and 1.

${contextBlock}

All extracted names:
${allNamesBlock}

Flagged names to repair:
${flaggedBlock}
`;

  const modelText = await callJsonResponse({
    traceId,
    payload: {
      model: "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: instructions }],
        },
      ],
      text: { format: { type: "json_object" } },
    },
  });

  const parsed = parseModelJson<ParsedNameRepair>(modelText);
  const entries = Array.isArray(parsed.items) ? parsed.items : [];

  const cleaned: Array<{ raw_name: string; repaired_name: string; confidence: number }> = [];
  for (const entry of entries) {
    const rawName = sanitizeText(entry.raw_name);
    const repairedName = sanitizeText(entry.repaired_name);
    const confidence = typeof entry.confidence === "number" ? entry.confidence : -1;

    if (!rawName || !repairedName) continue;
    if (!Number.isFinite(confidence)) continue;

    cleaned.push({
      raw_name: rawName,
      repaired_name: repairedName,
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }

  return cleaned;
}

