import { describe, expect, it } from 'vitest';
import { cleanupExtractedItems } from '@/lib/extraction/cleanup';
import type { ProcessedLineItem } from '@/lib/extraction/postprocess';

function row(partial: Partial<ProcessedLineItem>): ProcessedLineItem {
  return {
    lineOrdinal: partial.lineOrdinal ?? 0,
    name_raw: partial.name_raw ?? '',
    name_final: partial.name_final ?? '',
    normalized_name: partial.normalized_name ?? '',
    price_raw: partial.price_raw ?? null,
    price_final: partial.price_final ?? null,
    unit_price: partial.unit_price ?? null,
    quantity: partial.quantity ?? 1,
    confidence: partial.confidence ?? 0.8,
    included: partial.included ?? true,
    group_key: null,
    grouped: false,
    duplicate_of: null,
  };
}

describe('cleanupExtractedItems', () => {
  it('merges duplicate dishes and expands abbreviations', () => {
    const input = [
      row({ lineOrdinal: 0, name_raw: 'CHK TACO', name_final: 'CHK TACO', quantity: 1, price_final: 8 }),
      row({ lineOrdinal: 1, name_raw: 'Chicken Taco', name_final: 'Chicken Taco', quantity: 2, price_final: 16 }),
    ];

    const output = cleanupExtractedItems(input);
    expect(output).toHaveLength(1);
    expect(output[0].name_final).toBe('Chicken Taco');
    expect(output[0].quantity).toBe(3);
    expect(output[0].price_final).toBe(24);
    expect(output[0].unit_price).toBe(8);
    expect(output[0].included).toBe(true);
  });

  it('marks misc line items as excluded', () => {
    const input = [
      row({ name_raw: 'Tax', name_final: 'Tax', price_final: 2.35 }),
      row({ name_raw: 'Service Charge', name_final: 'Service Charge', price_final: 3.2 }),
      row({ name_raw: 'Shr Bowl', name_final: 'Shr Bowl', price_final: 12 }),
    ];

    const output = cleanupExtractedItems(input);
    expect(output.find((item) => item.name_final === 'Tax')?.included).toBe(false);
    expect(output.find((item) => item.name_final === 'Service Charge')?.included).toBe(false);
    expect(output.find((item) => item.name_final === 'Shrimp Bowl')?.included).toBe(true);
  });

  it('is deterministic for same input', () => {
    const input = [
      row({ lineOrdinal: 2, name_raw: '  chk!!! ', name_final: '  chk!!! ', quantity: 1, price_final: 9.99 }),
      row({ lineOrdinal: 1, name_raw: 'tip', name_final: 'tip', quantity: 1, price_final: 2 }),
    ];

    const a = cleanupExtractedItems(input);
    const b = cleanupExtractedItems(input);
    expect(a).toEqual(b);
  });
});
