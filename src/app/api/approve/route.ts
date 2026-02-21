import { NextResponse } from 'next/server';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { TableInsert, TableRow } from '@/lib/supabase/types';
import { toDishKey } from '@/lib/utils';

export async function POST(request: Request) {
  const body = (await request.json()) as { uploadId?: string };

  if (!body.uploadId) {
    return NextResponse.json({ ok: false, error: 'uploadId is required' }, { status: 400 });
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

  const restaurantName = restaurant?.name ?? 'unknown-restaurant';

  if (items.length) {
    const entries: TableInsert<'dish_entries'>[] = items.map((item) => {
      const finalName = item.name_final || item.name_raw;
      return {
        user_id: upload.user_id,
        restaurant_id: upload.restaurant_id,
        dish_name: finalName,
        price_original: item.price_final,
        currency_original: upload.currency_detected || 'USD',
        price_usd: item.price_final,
        eaten_at: upload.visited_at ?? upload.created_at,
        source_upload_id: upload.id,
        dish_key: toDishKey(`${restaurantName} ${finalName}`),
        rating: item.rating,
        comment: item.comment,
      };
    });

    await supabase.from('dish_entries').insert(entries);
  }

  await supabase.from('receipt_uploads').update({ status: 'approved' }).eq('id', body.uploadId);

  return NextResponse.json({ ok: true });
}
