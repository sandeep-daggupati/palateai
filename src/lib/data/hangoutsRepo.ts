import { SupabaseClient } from '@supabase/supabase-js';
import { Database, DishEntry, Json } from '@/lib/supabase/types';

type AnyClient = SupabaseClient<Database>;

export type HangoutRow = {
  id: string;
  owner_user_id: string;
  restaurant_id: string | null;
  occurred_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type HangoutParticipantRow = {
  hangout_id: string;
  user_id: string;
  created_at: string;
};

export type HangoutSourceType = 'receipt' | 'dish_photo' | 'hangout_photo' | 'manual';

export type HangoutSourceRow = {
  id: string;
  hangout_id: string;
  type: HangoutSourceType;
  storage_path: string | null;
  extractor: 'openai' | null;
  extracted_at: string | null;
  extraction_version: string | null;
  raw_extraction: Json | null;
  created_at: string;
};

export type HangoutItemRow = {
  id: string;
  hangout_id: string;
  source_id: string | null;
  name_raw: string;
  name_final: string | null;
  quantity: number;
  unit_price: number | null;
  currency: string | null;
  line_total: number | null;
  confidence: number | null;
  included: boolean;
  created_at: string;
};

export type HangoutDetails = {
  hangout: HangoutRow;
  participants: HangoutParticipantRow[];
  sources: HangoutSourceRow[];
};

export type UpsertHangoutItemInput = {
  id?: string;
  source_id?: string | null;
  name_raw: string;
  name_final?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  currency?: string | null;
  confidence?: number | null;
  included?: boolean;
};

type CreateHangoutInput = {
  owner_user_id: string;
  restaurant_id?: string | null;
  occurred_at?: string;
  note?: string | null;
  id?: string;
};

function db(client: AnyClient) {
  return client as unknown as {
    from: (table: string) => any;
  };
}

export async function createHangout(client: AnyClient, input: CreateHangoutInput): Promise<HangoutRow> {
  const payload = {
    id: input.id,
    owner_user_id: input.owner_user_id,
    restaurant_id: input.restaurant_id ?? null,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    note: input.note ?? null,
  };

  const { data, error } = await db(client).from('hangouts').insert(payload).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Could not create hangout');

  await addParticipants(client, data.id as string, [input.owner_user_id]);
  return data as HangoutRow;
}

export async function getHangout(client: AnyClient, hangoutId: string, userId: string): Promise<HangoutDetails | null> {
  const { data: hangout, error } = await db(client).from('hangouts').select('*').eq('id', hangoutId).maybeSingle();

  if (error) throw new Error(error.message);
  if (!hangout) return null;
  if ((hangout as HangoutRow).owner_user_id !== userId) {
    const { data: participant } = await db(client)
      .from('hangout_participants')
      .select('hangout_id')
      .eq('hangout_id', hangoutId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!participant) return null;
  }

  const [{ data: participants }, { data: sources }] = await Promise.all([
    db(client).from('hangout_participants').select('*').eq('hangout_id', hangoutId),
    db(client).from('hangout_sources').select('*').eq('hangout_id', hangoutId).order('created_at', { ascending: false }),
  ]);

  return {
    hangout: hangout as HangoutRow,
    participants: (participants ?? []) as HangoutParticipantRow[],
    sources: (sources ?? []) as HangoutSourceRow[],
  };
}

export async function listHangouts(client: AnyClient, userId: string): Promise<HangoutRow[]> {
  const [ownedResult, participantResult] = await Promise.all([
    db(client)
      .from('hangouts')
      .select('*')
      .eq('owner_user_id', userId)
      .order('occurred_at', { ascending: false })
      .limit(50),
    db(client).from('hangout_participants').select('hangout_id').eq('user_id', userId).limit(200),
  ]);

  if (ownedResult.error) throw new Error(ownedResult.error.message);
  if (participantResult.error) throw new Error(participantResult.error.message);

  const participantIds = Array.from(
    new Set(((participantResult.data ?? []) as Array<{ hangout_id: string }>).map((row) => row.hangout_id).filter(Boolean)),
  );

  let participantHangouts: HangoutRow[] = [];
  if (participantIds.length) {
    const { data, error } = await db(client)
      .from('hangouts')
      .select('*')
      .in('id', participantIds)
      .order('occurred_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    participantHangouts = (data ?? []) as HangoutRow[];
  }

  const merged = [...((ownedResult.data ?? []) as HangoutRow[]), ...participantHangouts];
  const deduped = merged.filter((row, index, arr) => arr.findIndex((entry) => entry.id === row.id) === index);
  deduped.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  return deduped.slice(0, 50);
}

export async function addParticipants(client: AnyClient, hangoutId: string, userIds: string[]): Promise<void> {
  const deduped = Array.from(new Set(userIds.filter(Boolean)));
  if (!deduped.length) return;

  const rows = deduped.map((userId) => ({
    hangout_id: hangoutId,
    user_id: userId,
  }));

  const { error } = await db(client).from('hangout_participants').upsert(rows, {
    onConflict: 'hangout_id,user_id',
    ignoreDuplicates: true,
  });
  if (error) throw new Error(error.message);
}

export async function createHangoutSource(
  client: AnyClient,
  params: Omit<HangoutSourceRow, 'id' | 'created_at'>,
): Promise<HangoutSourceRow> {
  const { data, error } = await db(client).from('hangout_sources').insert(params).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Could not create hangout source');
  return data as HangoutSourceRow;
}

export async function listHangoutItems(client: AnyClient, hangoutId: string): Promise<HangoutItemRow[]> {
  const { data, error } = await db(client)
    .from('hangout_items')
    .select('*')
    .eq('hangout_id', hangoutId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as HangoutItemRow[];
}

export async function upsertHangoutItems(client: AnyClient, hangoutId: string, items: UpsertHangoutItemInput[]): Promise<HangoutItemRow[]> {
  if (!items.length) return [];

  const payload = items.map((item) => ({
    id: item.id,
    hangout_id: hangoutId,
    source_id: item.source_id ?? null,
    name_raw: item.name_raw,
    name_final: item.name_final ?? null,
    quantity: Math.max(1, item.quantity ?? 1),
    unit_price: item.unit_price ?? null,
    currency: item.currency ?? 'USD',
    confidence: item.confidence ?? null,
    included: item.included ?? true,
  }));

  const { data, error } = await db(client)
    .from('hangout_items')
    .upsert(payload, { onConflict: 'id' })
    .select('*');

  if (error) throw new Error(error.message);
  return (data ?? []) as HangoutItemRow[];
}

export async function listMyDishEntriesForHangout(client: AnyClient, hangoutId: string, userId: string): Promise<DishEntry[]> {
  const { data, error } = await db(client)
    .from('dish_entries')
    .select('*')
    .eq('hangout_id', hangoutId)
    .eq('user_id', userId)
    .order('eaten_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as DishEntry[];
}
