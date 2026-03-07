// src/lib/extraction/openaiVision.ts
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
- datetime should be receipt date/time if visible, in ISO string when possible; otherwise null.
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
    const name = typeof it.name === "string" ? it.name.trim() : "";
    const price = it.price;

    if (!name || name.length > 120) continue;
    if (!isFiniteNumber(price)) continue;
    if (price <= 0 || price > 500) continue;

    cleaned.push({ name, price: Math.round(price * 100) / 100 });
  }

  console.info(`[extract:${traceId}] openaiVision.cleaned`, {
    parsedItems: items.length,
    keptItems: cleaned.length,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
  });

  return {
    items: cleaned,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
    merchant: {
      name: typeof parsed.merchant?.name === "string" ? parsed.merchant.name.trim() || null : null,
      address: typeof parsed.merchant?.address === "string" ? parsed.merchant.address.trim() || null : null,
      phone: typeof parsed.merchant?.phone === "string" ? parsed.merchant.phone.trim() || null : null,
    },
    datetime: typeof parsed.datetime === "string" ? parsed.datetime.trim() || null : null,
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
    const rawName = typeof entry.raw_name === "string" ? entry.raw_name.trim() : "";
    const repairedName = typeof entry.repaired_name === "string" ? entry.repaired_name.trim() : "";
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
