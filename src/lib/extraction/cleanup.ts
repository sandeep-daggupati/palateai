import { normalizeName, toTitleCase } from '@/lib/extraction/normalize';
import type { ProcessedLineItem } from '@/lib/extraction/postprocess';

type CleanupOptions = {
  restaurantContext?: string | null;
};

const MISC_KEYWORDS = [
  'water',
  'soda refill',
  'refill',
  'delivery fee',
  'bag fee',
  'tax',
  'tip',
  'service charge',
  'discount',
  'gratuity',
  'fees',
  'charge',
];

const EXTRA_ABBREVIATIONS: Record<string, string> = {
  chk: 'chicken',
  shr: 'shrimp',
};

function round(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

function expandAbbreviations(value: string): string {
  const tokens = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const cleaned = token.replace(/[^a-z0-9]/gi, '').toLowerCase();
      return EXTRA_ABBREVIATIONS[cleaned] ?? token;
    });
  return tokens.join(' ');
}

function normalizeDisplayName(value: string, restaurantContext: string | null): string {
  const expanded = expandAbbreviations(value);
  const normalized = normalizeName(expanded);
  if (!normalized) return value.trim();
  // Context hook kept deterministic; ready for restaurant-specific dictionary later.
  if (restaurantContext) {
    return toTitleCase(normalized);
  }
  return toTitleCase(normalized);
}

function isMiscItem(name: string): boolean {
  const normalized = normalizeName(name);
  if (!normalized) return true;
  return MISC_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function lineTotal(item: ProcessedLineItem): number | null {
  if (item.unit_price != null) return round(item.unit_price * Math.max(1, item.quantity));
  if (item.price_final != null) return round(item.price_final);
  return null;
}

export function cleanupExtractedItems(items: ProcessedLineItem[], options: CleanupOptions = {}): ProcessedLineItem[] {
  if (items.length === 0) return [];

  const prepared = items.map((item) => {
    const qty = Math.max(1, item.quantity ?? 1);
    const cleanedName = normalizeDisplayName(item.name_final || item.name_raw, options.restaurantContext ?? null);
    const normalized = normalizeName(cleanedName);
    const total = lineTotal(item);
    const unit = total == null ? null : round(total / qty);
    const included = !isMiscItem(cleanedName);

    return {
      ...item,
      name_final: cleanedName,
      normalized_name: normalized,
      quantity: qty,
      price_final: total,
      unit_price: unit,
      included,
      group_key: null,
      grouped: false,
      duplicate_of: null,
    };
  });

  const grouped = new Map<string, ProcessedLineItem[]>();
  for (const item of prepared) {
    const key = item.normalized_name || normalizeName(item.name_raw);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }

  const merged: ProcessedLineItem[] = [];
  grouped.forEach((bucket) => {
    const first = bucket[0];
    if (bucket.length === 1) {
      merged.push(first);
      return;
    }

    const quantity = bucket.reduce((sum, row) => sum + Math.max(1, row.quantity ?? 1), 0);
    const total = round(bucket.reduce((sum, row) => sum + (lineTotal(row) ?? 0), 0));
    const weightedConfidence =
      quantity > 0
        ? bucket.reduce((sum, row) => sum + (row.confidence ?? 0.5) * Math.max(1, row.quantity ?? 1), 0) / quantity
        : first.confidence;

    merged.push({
      ...first,
      lineOrdinal: Math.min(...bucket.map((row) => row.lineOrdinal)),
      quantity,
      price_raw: round(bucket.reduce((sum, row) => sum + (row.price_raw ?? 0), 0)),
      price_final: total,
      unit_price: total == null ? null : round(total / quantity),
      confidence: round(weightedConfidence) ?? first.confidence,
      included: bucket.every((row) => row.included),
      group_key: null,
      grouped: false,
      duplicate_of: null,
    });
  });

  return merged.sort((a, b) => a.lineOrdinal - b.lineOrdinal);
}
