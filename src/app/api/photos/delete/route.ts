import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/api/auth';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type DeleteBody = {
  photoId?: string;
};

export async function DELETE(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  const photoId = body?.photoId?.trim();
  if (!photoId) {
    return NextResponse.json({ error: 'photoId is required' }, { status: 400 });
  }

  const supabase = getServiceSupabaseClient();
  const { data: photo } = await supabase
    .from('photos')
    .select('id,user_id,kind,hangout_id,dish_entry_id')
    .eq('id', photoId)
    .maybeSingle();

  if (!photo?.id) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  let canDelete = photo.user_id === auth.userId;
  if (!canDelete && photo.hangout_id && photo.kind === 'hangout') {
    const { data: owner } = await supabase
      .from('receipt_uploads')
      .select('id')
      .eq('id', photo.hangout_id)
      .eq('user_id', auth.userId)
      .maybeSingle();
    canDelete = Boolean(owner?.id);
  } else if (!canDelete && photo.hangout_id) {
    const [{ data: owner }, { data: participant }] = await Promise.all([
      supabase.from('receipt_uploads').select('id').eq('id', photo.hangout_id).eq('user_id', auth.userId).maybeSingle(),
      supabase
        .from('visit_participants')
        .select('visit_id')
        .eq('visit_id', photo.hangout_id)
        .eq('user_id', auth.userId)
        .eq('status', 'active')
        .maybeSingle(),
    ]);
    canDelete = Boolean(owner?.id || participant?.visit_id);
  }
  if (!canDelete && photo.dish_entry_id) {
    const { data: entry } = await supabase
      .from('dish_entries')
      .select('source_upload_id')
      .eq('id', photo.dish_entry_id)
      .maybeSingle();
    if (entry?.source_upload_id) {
      const [{ data: owner }, { data: participant }] = await Promise.all([
        supabase.from('receipt_uploads').select('id').eq('id', entry.source_upload_id).eq('user_id', auth.userId).maybeSingle(),
        supabase
          .from('visit_participants')
          .select('visit_id')
          .eq('visit_id', entry.source_upload_id)
          .eq('user_id', auth.userId)
          .eq('status', 'active')
          .maybeSingle(),
      ]);
      canDelete = Boolean(owner?.id || participant?.visit_id);
    }
  }

  if (!canDelete) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  const { error } = await supabase.from('photos').delete().eq('id', photoId);
  if (error) {
    return NextResponse.json({ error: 'Failed to delete photo' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
