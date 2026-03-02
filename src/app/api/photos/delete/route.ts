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
    .select('id,user_id,hangout_id')
    .eq('id', photoId)
    .maybeSingle();

  if (!photo?.id) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  let canDelete = photo.user_id === auth.userId;
  if (!canDelete && photo.hangout_id) {
    const { data: hangout } = await supabase
      .from('hangouts')
      .select('id')
      .eq('id', photo.hangout_id)
      .eq('owner_user_id', auth.userId)
      .maybeSingle();
    canDelete = Boolean(hangout?.id);
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
