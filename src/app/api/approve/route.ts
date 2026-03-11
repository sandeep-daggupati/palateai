import { NextResponse } from 'next/server';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { DishIdentityTag, TableInsert, TableRow } from '@/lib/supabase/types';
import { normalizeName } from '@/lib/extraction/normalize';
import { toDishKey } from '@/lib/utils';
import { ensureDishCatalogEntry } from '@/lib/data/dishCatalog';

type ApproveBody = {
  uploadId?: string;
  identities?: Array<{ lineItemId: string; identityTag: DishIdentityTag | null }>;
};

type GroupedApprovalRow = {
  groupKey: string;
  dishName: string;
  quantity: number;
  unitPrice: number | null;
  identity: DishIdentityTag | null;
  rating: number | null;
  comment: string | null;
};

const VALID_IDENTITIES: DishIdentityTag[] = ['go_to', 'hidden_gem', 'special_occasion', 'try_again', 'never_again'];

function sanitizeIdentity(value: DishIdentityTag | null | undefined): DishIdentityTag | null {
  if (!value) return null;
  return VALID_IDENTITIES.includes(value) ? value : null;
}

function getGroupKey(item: TableRow<'extracted_line_items'>): string {
  if (item.group_key) return item.group_key;
  const finalName = item.name_final || item.name_raw;
  const normalized = normalizeName(finalName);
  const price = item.unit_price ?? item.price_final;
  return `${normalized}|${price == null ? 'na' : price.toFixed(2)}`;
}

function buildGroupedApprovalRows(params: {
  items: TableRow<'extracted_line_items'>[];
  identityByLineItemId: Map<string, DishIdentityTag | null>;
}): GroupedApprovalRow[] {
  const grouped = new Map<string, GroupedApprovalRow>();

  for (const item of params.items) {
    const key = getGroupKey(item);
    const finalName = (item.name_final || item.name_raw).trim();
    const quantity = Math.max(1, item.quantity ?? 1);
    const unitPrice = item.unit_price ?? item.price_final ?? null;
    const identity = params.identityByLineItemId.get(item.id) ?? null;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        groupKey: key,
        dishName: finalName,
        quantity,
        unitPrice,
        identity,
        rating: item.rating,
        comment: item.comment,
      });
      continue;
    }

    existing.quantity += quantity;
    if (!existing.identity && identity) existing.identity = identity;
    if (existing.rating == null && item.rating != null) existing.rating = item.rating;
    if (!existing.comment && item.comment) existing.comment = item.comment;
  }

  return Array.from(grouped.values());
}

function buildLearnedMappings(params: {
  items: TableRow<'extracted_line_items'>[];
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
  const body = (await request.json()) as ApproveBody;

  if (!body.uploadId) {
    return NextResponse.json({ ok: false, error: 'uploadId is required' }, { status: 400 });
  }

  const identityByLineItemId = new Map<string, DishIdentityTag | null>();
  for (const entry of body.identities ?? []) {
    if (!entry.lineItemId) continue;
    identityByLineItemId.set(entry.lineItemId, sanitizeIdentity(entry.identityTag));
  }

  const supabase = getServiceSupabaseClient();
  const { data: uploadData } = await supabase.from('receipt_uploads').select('*').eq('id', body.uploadId).single();
  const upload = uploadData as TableRow<'receipt_uploads'> | null;

  if (!upload) {
    return NextResponse.json({ ok: false, error: 'Upload not found' }, { status: 404 });
  }

  const { data: restaurantData } = upload.restaurant_id
    ? await supabase.from('restaurants').select('name').eq('id', upload.restaurant_id).single()
    : { data: null };
  const restaurant = restaurantData as Pick<TableRow<'restaurants'>, 'name'> | null;

  const { data: itemData } = await supabase
    .from('extracted_line_items')
    .select('*')
    .eq('upload_id', body.uploadId)
    .eq('included', true);
  const items = (itemData ?? []) as TableRow<'extracted_line_items'>[];

  const learnedMappings = buildLearnedMappings({
    items,
    userId: upload.user_id,
    restaurantId: upload.restaurant_id,
  });

  if (learnedMappings.length) {
    if (upload.restaurant_id) {
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
          await supabase
            .from('dish_name_mappings')
            .update({ normalized_name: row.normalized_name })
            .eq('id', existing.id);
        } else {
          await supabase.from('dish_name_mappings').insert(row);
        }
      }
    }
  }

  const restaurantName = restaurant?.name ?? 'unknown-restaurant';

  if (items.length) {
    const groupedRows = buildGroupedApprovalRows({ items, identityByLineItemId });
    const groupedRowByDishKey = new Map(groupedRows.map((row) => [toDishKey(`${restaurantName} ${row.dishName}`), row]));
    const entries: TableInsert<'dish_entries'>[] = groupedRows.map((row) => ({
      user_id: upload.user_id,
      restaurant_id: upload.restaurant_id,
      dish_name: row.dishName,
      price_original: row.unitPrice,
      currency_original: upload.currency_detected || 'USD',
      price_usd: row.unitPrice,
      quantity: row.quantity,
      eaten_at: upload.visited_at ?? upload.created_at,
      source_upload_id: upload.id,
      dish_key: toDishKey(`${restaurantName} ${row.dishName}`),
    }));

    const { data: savedEntries } = await supabase
      .from('dish_entries')
      .upsert(entries, {
      onConflict: 'user_id,source_upload_id,dish_key',
      })
      .select('id,dish_key,dish_name');

    const typedSavedEntries = (savedEntries ?? []) as Array<{ id: string; dish_key: string; dish_name: string }>;
    if (typedSavedEntries.length > 0) {
      const { count: activeParticipantCount } = await supabase
        .from('visit_participants')
        .select('id', { count: 'exact', head: true })
        .eq('visit_id', upload.id)
        .eq('status', 'active');

      const isSoloHangout = (activeParticipantCount ?? 0) <= 1;
      if (isSoloHangout) {
        await supabase.from('dish_entry_participants').upsert(
          typedSavedEntries.map((entry) => ({
            dish_entry_id: entry.id,
            user_id: upload.user_id,
            had_it: true,
          })),
          { onConflict: 'dish_entry_id,user_id' },
        );

        await supabase.from('personal_food_entries').upsert(
          typedSavedEntries.map((entry) => ({
            user_id: upload.user_id,
            source_dish_entry_id: entry.id,
            source_hangout_id: upload.id,
            restaurant_id: upload.restaurant_id,
            dish_key: entry.dish_key,
            dish_name: entry.dish_name,
            had_it: true,
            detached_from_hangout: false,
          })),
          { onConflict: 'user_id,source_dish_entry_id' },
        );
      }

      const explicitPersonalRows = typedSavedEntries
        .map((entry) => {
          const grouped = groupedRowByDishKey.get(entry.dish_key);
          if (!grouped) return null;
          const note = grouped.comment?.trim() ? grouped.comment.trim() : null;
          const reactionTag = grouped.identity ?? null;
          const rating = grouped.rating ?? null;
          const hasExplicitInteraction = Boolean(note || reactionTag || rating != null);
          if (!hasExplicitInteraction) return null;
          return {
            user_id: upload.user_id,
            source_dish_entry_id: entry.id,
            source_hangout_id: upload.id,
            restaurant_id: upload.restaurant_id,
            dish_key: entry.dish_key,
            dish_name: entry.dish_name,
            price: grouped.unitPrice,
            rating,
            note,
            reaction_tag: reactionTag,
            had_it: true,
            detached_from_hangout: false,
          };
        })
        .filter((row): row is {
          user_id: string;
          source_dish_entry_id: string;
          source_hangout_id: string;
          restaurant_id: string | null;
          dish_key: string;
          dish_name: string;
          price: number | null;
          rating: number | null;
          note: string | null;
          reaction_tag: DishIdentityTag | null;
          had_it: boolean;
          detached_from_hangout: boolean;
        } => Boolean(row));

      if (explicitPersonalRows.length > 0) {
        await supabase
          .from('personal_food_entries')
          .upsert(explicitPersonalRows, { onConflict: 'user_id,source_dish_entry_id' });
      }

      await Promise.all(
        typedSavedEntries.map(async (entry) => {
          if (!entry.dish_key) return;
          try {
            await ensureDishCatalogEntry({
              dishKey: entry.dish_key,
              dishName: entry.dish_name,
              restaurantName: restaurant?.name ?? null,
            });
          } catch (error) {
            console.error('Dish catalog enrichment failed:', error);
          }
        }),
      );
    }
  }

  return NextResponse.json({ ok: true });
}
