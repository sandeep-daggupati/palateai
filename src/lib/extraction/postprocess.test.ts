import test from 'node:test';
import assert from 'node:assert/strict';
import { detectQuantity, normalizeName } from '@/lib/extraction/normalize';
import { postProcessExtractedItems } from '@/lib/extraction/postprocess';

test('detectQuantity parses common formats', () => {
  assert.deepEqual(detectQuantity('2x CHK TACOS'), { qty: 2, cleaned: 'CHK TACOS' });
  assert.deepEqual(detectQuantity('CHK TACOS x2'), { qty: 2, cleaned: 'CHK TACOS' });
  assert.deepEqual(detectQuantity('CHK TACOS (2)'), { qty: 2, cleaned: 'CHK TACOS' });
});

test('normalizeName expands abbreviations', () => {
  assert.equal(normalizeName('CHK WRAP'), 'chicken wrap');
});

test('grouping merges same name and unit price', async () => {
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
  assert.equal(groupedRows.length, 2);
  assert.equal(rows[2].grouped, false);
});

test('mappings apply before repair and repair only flagged', async () => {
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

  assert.equal(rows[0].name_final, 'Chicken Wrap');
  assert.equal(repairCalls, 1);
  assert.equal(rows[1].name_final, 'Salad');
});
