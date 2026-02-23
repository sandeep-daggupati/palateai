import { buildGroupKey, detectQuantity, normalizeName, shouldFlagNameForRepair, toTitleCase } from "@/lib/extraction/normalize";

export type ExtractedVisionItem = {
  name: string;
  price: number;
};

export type DishNameMappingRecord = {
  raw_name: string;
  normalized_name: string;
  restaurant_id: string | null;
};

export type TextRepairResult = {
  raw_name: string;
  repaired_name: string;
  confidence: number;
};

export type ProcessedLineItem = {
  lineOrdinal: number;
  name_raw: string;
  name_final: string;
  normalized_name: string;
  price_raw: number | null;
  price_final: number | null;
  unit_price: number | null;
  quantity: number;
  confidence: number;
  included: boolean;
  group_key: string | null;
  grouped: boolean;
  duplicate_of: string | null;
};

type PostProcessParams = {
  items: ExtractedVisionItem[];
  currency: string | null;
  mappings: DishNameMappingRecord[];
  restaurantContext: string | null;
  repairNames: ((params: { flaggedRawNames: string[]; restaurantContext: string | null; allNames: string[] }) => Promise<TextRepairResult[]>) | null;
};

type DraftLine = {
  lineOrdinal: number;
  name_raw: string;
  name_final: string;
  normalized_name: string;
  price_raw: number | null;
  price_final: number | null;
  unit_price: number | null;
  quantity: number;
  confidence: number;
  included: boolean;
  group_key: string | null;
  grouped: boolean;
  duplicate_of: string | null;
};

function roundPrice(value: number | null): number | null {
  if (value == null) return null;
  return Math.round(value * 100) / 100;
}

function normalizeMappingKey(value: string): string {
  return normalizeName(value);
}

function buildMappingIndex(mappings: DishNameMappingRecord[]) {
  const byRestaurant = new Map<string, string>();
  const globalMap = new Map<string, string>();

  for (const mapping of mappings) {
    const key = normalizeMappingKey(mapping.raw_name);
    if (!key) continue;

    if (mapping.restaurant_id) {
      byRestaurant.set(key, mapping.normalized_name.trim());
    } else {
      globalMap.set(key, mapping.normalized_name.trim());
    }
  }

  return { byRestaurant, globalMap };
}

function applyMappingName(rawName: string, indexes: ReturnType<typeof buildMappingIndex>): string | null {
  const key = normalizeMappingKey(rawName);
  if (!key) return null;

  const restaurantMatch = indexes.byRestaurant.get(key);
  if (restaurantMatch) return restaurantMatch;

  const globalMatch = indexes.globalMap.get(key);
  if (globalMatch) return globalMatch;

  return null;
}

function pickDefaultName(rawName: string): string {
  const normalized = normalizeName(rawName);
  if (!normalized) return rawName.trim();
  return toTitleCase(normalized);
}

function assignGrouping(lines: DraftLine[], currency: string | null): DraftLine[] {
  const byGroup = new Map<string, DraftLine[]>();

  for (const line of lines) {
    const unit = line.unit_price;
    const key = buildGroupKey({
      normalizedName: line.normalized_name,
      unitPrice: unit,
      currency,
    });
    const existing = byGroup.get(key);
    if (existing) {
      existing.push(line);
    } else {
      byGroup.set(key, [line]);
    }
  }

  const next: DraftLine[] = [];
  for (const [, members] of byGroup) {
    const primary = members[0];
    const grouped = members.length > 1;

    for (let i = 0; i < members.length; i += 1) {
      const member = members[i];
      next.push({
        ...member,
        group_key: grouped ? buildGroupKey({ normalizedName: primary.normalized_name, unitPrice: primary.unit_price, currency }) : null,
        grouped,
        duplicate_of: null,
      });
    }
  }

  return next.sort((a, b) => a.lineOrdinal - b.lineOrdinal);
}

function shouldUseRepair(line: DraftLine): boolean {
  return shouldFlagNameForRepair({
    rawName: line.name_raw,
    normalizedName: line.normalized_name,
    confidence: line.confidence,
  });
}

export async function postProcessExtractedItems(params: PostProcessParams): Promise<ProcessedLineItem[]> {
  const mappingIndex = buildMappingIndex(params.mappings);

  let lines: DraftLine[] = params.items.map((item, idx) => {
    const quantityInfo = detectQuantity(item.name);
    const mapped = applyMappingName(quantityInfo.cleaned, mappingIndex);
    const finalName = mapped || pickDefaultName(quantityInfo.cleaned);
    const normalized = normalizeName(finalName);

    return {
      lineOrdinal: idx,
      name_raw: item.name,
      name_final: finalName,
      normalized_name: normalized,
      price_raw: roundPrice(item.price),
      price_final: roundPrice(item.price),
      unit_price: roundPrice(item.price),
      quantity: Math.max(1, quantityInfo.qty),
      confidence: 0.75,
      included: true,
      group_key: null,
      grouped: false,
      duplicate_of: null,
    };
  });

  lines = assignGrouping(lines, params.currency);

  if (params.repairNames) {
    const flagged = lines.filter(shouldUseRepair);
    if (flagged.length > 0) {
      const repaired = await params.repairNames({
        flaggedRawNames: flagged.map((line) => line.name_raw),
        restaurantContext: params.restaurantContext,
        allNames: lines.map((line) => line.name_raw),
      });

      const repairByRaw = new Map<string, TextRepairResult>();
      for (const entry of repaired) {
        if (!entry.raw_name?.trim()) continue;
        repairByRaw.set(entry.raw_name.trim().toLowerCase(), entry);
      }

      lines = lines.map((line) => {
        const candidate = repairByRaw.get(line.name_raw.trim().toLowerCase());
        if (!candidate || candidate.confidence < 0.6) {
          return line;
        }

        const nextName = candidate.repaired_name.trim();
        if (!nextName) return line;

        return {
          ...line,
          name_final: nextName,
          normalized_name: normalizeName(nextName),
          confidence: Math.max(line.confidence, candidate.confidence),
        };
      });

      lines = assignGrouping(lines, params.currency);
    }
  }

  return lines;
}

