import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/supabase/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

function getAnonSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing Supabase public environment variables.');
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing auth token' }, { status: 401 });
  }

  const anon = getAnonSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await anon.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const email = user.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: true, claimed: 0 });
  }

  const service = getServiceSupabaseClient();

  const { data: invitedRows, error: invitedError } = await service
    .from('visit_participants')
    .select('id,visit_id')
    .eq('invited_email', email)
    .is('user_id', null)
    .in('status', ['invited', 'active']);

  if (invitedError || !invitedRows || invitedRows.length === 0) {
    return NextResponse.json({ ok: true, claimed: 0 });
  }

  let claimed = 0;

  for (const row of invitedRows) {
    const { data: existingUserRow } = await service
      .from('visit_participants')
      .select('id')
      .eq('visit_id', row.visit_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingUserRow) {
      await service.from('visit_participants').delete().eq('id', row.id);
      continue;
    }

    const { error: updateError } = await service
      .from('visit_participants')
      .update({ user_id: user.id, status: 'active', invited_email: null })
      .eq('id', row.id);

    if (!updateError) {
      claimed += 1;
    }
  }

  return NextResponse.json({ ok: true, claimed });
}
