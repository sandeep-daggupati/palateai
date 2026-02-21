import { NextResponse } from 'next/server';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { toDishKey } from '@/lib/utils';

export async function POST(request: Request) {
  const body = (await request.json()) as { uploadId?: string };

  if (!body.uploadId) {
    return NextResponse.json({ ok: false, error: 'uploadId is required' }, { status: 400 });
  }

  const supabase = getServiceSupabaseClient();
  const { data: upload } = await supabase.from('receipt_uploads').select('*').eq('id', body.uploadId).single();

  if (!upload) {
    return NextResponse.json({ ok: false, error: 'Upload not found' }, { status: 404 });
  }

  const { data: restaurant } = upload.restaurant_id
    ? await supabase.from('restaurants').select('name').eq('id', upload.restaurant_id).single()
    : { data: null };

  const { data: items } = await supabase
    .from('extracted_line_items')
    .select('*')
    .eq('upload_id', body.uploadId)
    .eq('included', true);

  const restaurantName = restaurant?.name ?? 'unknown-restaurant';

  if (items && items.length) {
    await supabase.from('dish_entries').insert(
      items.map((item) => {
        const finalName = item.name_final || item.name_raw;
        return {
          user_id: upload.user_id,
          restaurant_id: upload.restaurant_id,
          dish_name: finalName,
          price_original: item.price_final,
          currency_original: upload.currency_detected || 'USD',
          price_usd: item.price_final,
          source_upload_id: body.uploadId,
          dish_key: toDishKey(`${restaurantName} ${finalName}`),
        };
      }),
    );
  }

  await supabase.from('receipt_uploads').update({ status: 'approved' }).eq('id', body.uploadId);

  return NextResponse.json({ ok: true });
}
