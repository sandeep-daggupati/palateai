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

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export async function extractLineItemsFromImage(params: {
  imageUrl: string; // signed URL
}): Promise<Extracted> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  // Responses API with image input; ask for strict JSON
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
      model: "gpt-4o-mini", // good MVP cost/perf; you can switch to "gpt-4o" if needed
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instructions },
            { type: "input_image", image_url: params.imageUrl },
          ],
        },
      ],
      // Encourage JSON-only output
      text: { format: { type: "json_object" } },
    }),
  });

  if (!resp.ok) {
    const msg = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${msg}`);
  }

  const data = (await resp.json()) as { output_text?: unknown };

  // Responses API returns text in output[].content[].text; but with json_object format,
  // the "output_text" field is commonly present.
  const outputText: string | undefined =
    typeof data.output_text === "string" ? data.output_text : undefined;

  const raw = outputText ?? JSON.stringify(data); // fallback for debugging; should not happen in normal flow

  let parsed: ParsedResponse;
  try {
    parsed = JSON.parse(outputText ?? "") as ParsedResponse;
  } catch {
    // Try to locate JSON in output if output_text isn't present
    // Conservative fallback: attempt to extract first JSON object substring.
    const s = raw;
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(s.slice(start, end + 1)) as ParsedResponse;
    } else {
      throw new Error("Failed to parse JSON from OpenAI response");
    }
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const cleaned: Extracted["items"] = [];

  for (const it of items) {
    const name = typeof it.name === "string" ? it.name.trim() : "";
    const price = it.price;

    if (!name || name.length > 120) continue;
    if (!isFiniteNumber(price)) continue;
    // sanity range (avoid totals like 1234.56)
    if (price <= 0 || price > 500) continue;

    cleaned.push({ name, price: Math.round(price * 100) / 100 });
  }

  return {
    items: cleaned,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
  };
}
