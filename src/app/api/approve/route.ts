import { NextResponse } from 'next/server';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { DishIdentityTag, TableInsert, TableRow } from '@/lib/supabase/types';
import { normalizeName } from '@/lib/extraction/normalize';
import { toDishKey } from '@/lib/utils';

type SaveBody = {
  uploadId?: string;
  hangoutId?: string;
  identities?: Array<{ lineItemId: string; identityTag: DishIdentityTag | null }>;
};

type GroupedSaveRow = {
  groupKey: string;
  dishName: string;
  quantity: number;
  unitPrice: number | null;
  identity: DishIdentityTag | null;
};

const VALID_IDENTITIES: DishIdentityTag[] = ['go_to', 'hidden_gem', 'special_occasion', 'try_again', 'never_again'];

function sanitizeIdentity(value: DishIdentityTag | null | undefined): DishIdentityTag | null {
  if (!value) return null;
  return VALID_IDENTITIES.includes(value) ? value : null;
}

function getGroupKey(item: TableRow<'hangout_items'>): string {
  const finalName = item.name_final || item.name_raw;
  const normalized = normalizeName(finalName);
  const price = item.unit_price;
  return `${normalized}|${price == null ? 'na' : Number(price).toFixed(2)}`;
}

function buildGroupedRows(params: {
  items: TableRow<'hangout_items'>[];
  identityByLineItemId: Map<string, DishIdentityTag | null>;
}): GroupedSaveRow[] {
  const grouped = new Map<string, GroupedSaveRow>();

  for (const item of params.items) {
    const key = getGroupKey(item);
    const finalName = (item.name_final || item.name_raw).trim();
    const quantity = Math.max(1, item.quantity ?? 1);
    const unitPrice = item.unit_price ?? null;
    const identity = params.identityByLineItemId.get(item.id) ?? null;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        groupKey: key,
        dishName: finalName,
        quantity,
        unitPrice,
        identity,
      });
      continue;
    }

    existing.quantity += quantity;
    if (!existing.identity && identity) existing.identity = identity;
  }

  return Array.from(grouped.values());
}

function buildLearnedMappings(params: {
  items: TableRow<'hangout_items'>[];
  userId: string;
  restaurantId: string | null;
}): Array<{ user_id: string; restaurant_id: string | null; raw_name: string; normalized_name: string }> {
  const rows: Array<{ user_id: string; restaurant_id: string | null; raw_name: string; normalized_name: string }> = [];

  for (const item of params.items) {
    const raw = item.name_raw.trim();
    const finalName = (item.name_final || item.name_raw).trim();
    if (!raw || !finalName) continue;
    if (normalizeName(raw) === normalizeName(finalName)) continue;

    rows.push({
      user_id: params.userId,
      restaurant_id: params.restaurantId,
      raw_name: raw,
      normalized_name: finalName,
    });
  }

  return rows;
}

export async function POST(request: Request) {
  const body = (await request.json()) as SaveBody;
  const hangoutId = body.hangoutId ?? body.uploadId;

  if (!hangoutId) {
    return NextResponse.json({ ok: false, error: 'hangoutId/uploadId is required' }, { status: 400 });
  }

  const identityByLineItemId = new Map<string, DishIdentityTag | null>();
  for (const entry of body.identities ?? []) {
    if (!entry.lineItemId) continue;
    identityByLineItemId.set(entry.lineItemId, sanitizeIdentity(entry.identityTag));
  }

  const supabase = getServiceSupabaseClient();
  const { data: hangoutData } = await supabase.from('hangouts').select('*').eq('id', hangoutId).single();
  const hangout = hangoutData as TableRow<'hangouts'> | null;

  if (!hangout) {
    return NextResponse.json({ ok: false, error: 'Hangout not found' }, { status: 404 });
  }

  const { data: restaurantData } = hangout.restaurant_id
    ? await supabase.from('restaurants').select('name').eq('id', hangout.restaurant_id).single()
    : { data: null };
  const restaurant = restaurantData as Pick<TableRow<'restaurants'>, 'name'> | null;

  const { data: itemData } = await supabase
    .from('hangout_items')
    .select('*')
    .eq('hangout_id', hangoutId)
    .eq('included', true);
  const items = (itemData ?? []) as TableRow<'hangout_items'>[];

  const learnedMappings = buildLearnedMappings({
    items,
    userId: hangout.owner_user_id,
    restaurantId: hangout.restaurant_id,
  });

  if (learnedMappings.length) {
    if (hangout.restaurant_id) {
      await supabase.from('dish_name_mappings').upsert(learnedMappings, {
        onConflict: 'user_id,restaurant_id,raw_name',
      });
    } else {
      for (const row of learnedMappings) {
        const { data: existing } = await supabase
          .from('dish_name_mappings')
          .select('id')
          .eq('user_id', row.user_id)
          .is('restaurant_id', null)
          .ilike('raw_name', row.raw_name)
          .maybeSingle();

        if (existing?.id) {
          await supabase.from('dish_name_mappings').update({ normalized_name: row.normalized_name }).eq('id', existing.id);
        } else {
          await supabase.from('dish_name_mappings').insert(row);
        }
      }
    }
  }

  const restaurantName = restaurant?.name ?? 'unknown-restaurant';
  if (items.length) {
    const groupedRows = buildGroupedRows({ items, identityByLineItemId });
    const entries: TableInsert<'dish_entries'>[] = groupedRows.map((row) => ({
      user_id: hangout.owner_user_id,
      restaurant_id: hangout.restaurant_id,
      hangout_id: hangout.id,
      dish_name: row.dishName,
      price_original: row.unitPrice,
      currency_original: 'USD',
      price_usd: row.unitPrice,
      quantity: row.quantity,
      eaten_at: hangout.occurred_at ?? hangout.created_at,
      source_upload_id: hangout.id,
      dish_key: toDishKey(`${restaurantName} ${row.dishName}`),
      identity_tag: row.identity,
    }));

    await supabase.from('dish_entries').upsert(entries, {
      onConflict: 'user_id,source_upload_id,dish_key',
    });
  }

  await supabase.from('hangouts').update({ updated_at: new Date().toISOString() }).eq('id', hangout.id);
  return NextResponse.json({ ok: true });
}
