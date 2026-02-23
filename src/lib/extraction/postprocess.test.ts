import { describe, expect, it } from 'vitest';
import { detectQuantity, normalizeName } from '@/lib/extraction/normalize';
import { postProcessExtractedItems } from '@/lib/extraction/postprocess';

describe('extraction postprocess', () => {
  it('detectQuantity parses common formats', () => {
    expect(detectQuantity('2 CHK TACOS')).toEqual({ qty: 2, cleaned: 'CHK TACOS' });
    expect(detectQuantity('CHK TACOS x2')).toEqual({ qty: 2, cleaned: 'CHK TACOS' });
    expect(detectQuantity('CHK TACOS (2)')).toEqual({ qty: 2, cleaned: 'CHK TACOS' });
  });

  it('normalizeName expands abbreviations', () => {
    expect(normalizeName('CHK WRAP')).toBe('chicken wrap');
  });

  it('grouping merges same name and unit price', async () => {
    const rows = await postProcessExtractedItems({
      items: [
        { name: 'CHK WRAP', price: 12.5 },
        { name: 'Chicken Wrap', price: 12.5 },
        { name: 'Chicken Wrap', price: 14.5 },
      ],
      currency: 'USD',
      mappings: [],
      restaurantContext: null,
      repairNames: null,
    });

    const groupedRows = rows.filter((row) => row.grouped);
    expect(groupedRows.length).toBe(2);
    expect(rows[2].grouped).toBe(false);
  });

  it('mappings apply before repair and repair only flagged', async () => {
    let repairCalls = 0;

    const rows = await postProcessExtractedItems({
      items: [
        { name: 'CHK WRAP', price: 11 },
        { name: 'SALAD', price: 9 },
      ],
      currency: 'USD',
      mappings: [
        {
          raw_name: 'CHK WRAP',
          normalized_name: 'Chicken Wrap',
          restaurant_id: null,
        },
      ],
      restaurantContext: 'Sample Restaurant',
      repairNames: async ({ flaggedRawNames }) => {
        repairCalls += 1;
        return flaggedRawNames.map((name) => ({
          raw_name: name,
          repaired_name: name === 'SALAD' ? 'Salad' : 'Chicken Wrap',
          confidence: name === 'SALAD' ? 0.2 : 0.9,
        }));
      },
    });

    expect(rows[0].name_final).toBe('Chicken Wrap');
    expect(repairCalls).toBe(1);
    expect(rows[1].name_final).toBe('Salad');
  });
});
