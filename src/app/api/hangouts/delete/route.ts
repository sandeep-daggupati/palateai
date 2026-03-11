import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/api/auth';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type DeleteHangoutBody = {
  hangoutId?: string;
};

export async function DELETE(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as DeleteHangoutBody | null;
  const hangoutId = body?.hangoutId?.trim();

  if (!hangoutId) {
    return NextResponse.json({ error: 'hangoutId is required' }, { status: 400 });
  }

  const supabase = getServiceSupabaseClient();

  const { data: ownerCheck } = await supabase
    .from('receipt_uploads')
    .select('id')
    .eq('id', hangoutId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (!ownerCheck?.id) {
    return NextResponse.json({ error: 'Only the hangout creator can delete this hangout' }, { status: 403 });
  }

  const { data, error } = await supabase.rpc('delete_hangout_preserve_personal_memories', {
    p_hangout_id: hangoutId,
    p_request_user_id: auth.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message || 'Failed to delete hangout' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: data });
}
