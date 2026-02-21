// src/lib/extraction/openaiVision.ts
type Extracted = {
  items: Array<{ name: string; price: number }>;
  currency: string | null;
  notes: string | null;
};

type ParsedItem = {
  name?: unknown;
  price?: unknown;
};

type ParsedResponse = {
  items?: ParsedItem[];
  currency?: unknown;
  notes?: unknown;
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

function parseModelJson(modelText: string): ParsedResponse {
  try {
    return JSON.parse(modelText) as ParsedResponse;
  } catch {
    const start = modelText.indexOf("{");
    const end = modelText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(modelText.slice(start, end + 1)) as ParsedResponse;
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
  "items": [{"name": string, "price": number}],
  "currency": string|null,
  "notes": string|null
}

Rules:
- Include only purchased menu items (dish/drink names) with their item prices.
- Ignore totals, subtotal, tax, tip, service fee, discounts, coupons, payment lines, change, tender, order IDs.
- If quantity appears (e.g. 2x), still return a single item name; price should be the line price shown.
- "price" must be a number like 15.95 (no currency symbols).
- Keep names as printed but trim whitespace.`;

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
    }),
  });

  console.info(`[extract:${traceId}] openaiVision.response`, {
    status: resp.status,
    ok: resp.ok,
  });

  if (!resp.ok) {
    const msg = await resp.text();
    console.error(`[extract:${traceId}] openaiVision.httpError`, {
      status: resp.status,
      body: truncate(msg),
    });
    throw new Error(`OpenAI error ${resp.status}: ${msg}`);
  }

  const data = (await resp.json()) as ResponsesOutput;
  const modelText = getResponseText(data);

  console.info(`[extract:${traceId}] openaiVision.payload`, {
    hasOutputText: typeof data.output_text === "string",
    outputGroups: Array.isArray(data.output) ? data.output.length : 0,
    hasModelText: Boolean(modelText),
    modelTextPreview: modelText ? truncate(modelText, 180) : null,
  });

  if (!modelText) {
    throw new Error("OpenAI returned no parseable text output");
  }

  const parsed = parseModelJson(modelText);

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
  };
}
