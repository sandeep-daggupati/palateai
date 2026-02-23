import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database, TableInsert, VisitParticipant } from '@/lib/supabase/types';
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

async function authorize(request: Request, visitId: string) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return { error: NextResponse.json({ ok: false, error: 'Missing auth token' }, { status: 401 }) };
  }

  const anon = getAnonSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await anon.auth.getUser(token);

  if (authError || !user) {
    return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  const service = getServiceSupabaseClient();
  const { data: visit } = await service.from('receipt_uploads').select('id,user_id').eq('id', visitId).single();

  if (!visit) {
    return { error: NextResponse.json({ ok: false, error: 'Visit not found' }, { status: 404 }) };
  }

  const isHost = visit.user_id === user.id;

  const { data: participantRow } = await service
    .from('visit_participants')
    .select('id,user_id,status')
    .eq('visit_id', visitId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  const isParticipant = Boolean(participantRow);

  return {
    service,
    user,
    visit,
    isHost,
    isParticipant,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const visitId = searchParams.get('visitId');

  if (!visitId) {
    return NextResponse.json({ ok: false, error: 'visitId is required' }, { status: 400 });
  }

  const auth = await authorize(request, visitId);
  if ('error' in auth) return auth.error;

  if (!auth.isHost && !auth.isParticipant) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const { data } = await auth.service
    .from('visit_participants')
    .select('id,visit_id,user_id,role,invited_email,status,created_at')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: true });

  return NextResponse.json({ ok: true, participants: (data ?? []) as VisitParticipant[] });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { visitId?: string; email?: string };

  if (!body.visitId || !body.email) {
    return NextResponse.json({ ok: false, error: 'visitId and email are required' }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: 'Valid email is required' }, { status: 400 });
  }

  const auth = await authorize(request, body.visitId);
  if ('error' in auth) return auth.error;

  if (!auth.isHost) {
    return NextResponse.json({ ok: false, error: 'Only host can share this visit' }, { status: 403 });
  }

  const users = await auth.service.auth.admin.listUsers({ page: 1, perPage: 500 });
  const matchedUser = users.data.users.find((row) => row.email?.toLowerCase() === email);

  if (matchedUser?.id === auth.user.id) {
    return NextResponse.json({ ok: false, error: 'Host is already part of this visit' }, { status: 400 });
  }

  let participant: VisitParticipant | null = null;

  if (matchedUser) {
    const { data: existingByUser } = await auth.service
      .from('visit_participants')
      .select('id,visit_id,user_id,role,invited_email,status,created_at')
      .eq('visit_id', body.visitId)
      .eq('user_id', matchedUser.id)
      .maybeSingle();

    if (existingByUser) {
      const { data: updated, error: updateError } = await auth.service
        .from('visit_participants')
        .update({ status: 'active', role: 'participant', invited_email: null })
        .eq('id', existingByUser.id)
        .select('id,visit_id,user_id,role,invited_email,status,created_at')
        .single();

      if (updateError) {
        return NextResponse.json({ ok: false, error: `Could not update participant: ${updateError.message}` }, { status: 500 });
      }

      participant = updated as VisitParticipant;
    } else {
      const insertPayload: TableInsert<'visit_participants'> = {
        visit_id: body.visitId,
        user_id: matchedUser.id,
        role: 'participant',
        status: 'active',
      };

      const { data: inserted, error: insertError } = await auth.service
        .from('visit_participants')
        .insert(insertPayload)
        .select('id,visit_id,user_id,role,invited_email,status,created_at')
        .single();

      if (insertError) {
        return NextResponse.json({ ok: false, error: `Could not add participant: ${insertError.message}` }, { status: 500 });
      }

      participant = inserted as VisitParticipant;
    }
  } else {
    const { data: existingByEmail } = await auth.service
      .from('visit_participants')
      .select('id,visit_id,user_id,role,invited_email,status,created_at')
      .eq('visit_id', body.visitId)
      .eq('invited_email', email)
      .maybeSingle();

    if (existingByEmail) {
      const { data: updated, error: updateError } = await auth.service
        .from('visit_participants')
        .update({ status: 'invited', role: 'participant', invited_email: email })
        .eq('id', existingByEmail.id)
        .select('id,visit_id,user_id,role,invited_email,status,created_at')
        .single();

      if (updateError) {
        return NextResponse.json({ ok: false, error: `Could not update invite: ${updateError.message}` }, { status: 500 });
      }

      participant = updated as VisitParticipant;
    } else {
      const insertPayload: TableInsert<'visit_participants'> = {
        visit_id: body.visitId,
        invited_email: email,
        role: 'participant',
        status: 'invited',
      };

      const { data: inserted, error: insertError } = await auth.service
        .from('visit_participants')
        .insert(insertPayload)
        .select('id,visit_id,user_id,role,invited_email,status,created_at')
        .single();

      if (insertError) {
        return NextResponse.json({ ok: false, error: `Could not add invite: ${insertError.message}` }, { status: 500 });
      }

      participant = inserted as VisitParticipant;
    }
  }

  await auth.service
    .from('receipt_uploads')
    .update({ is_shared: true, share_visibility: 'private' })
    .eq('id', body.visitId);

  return NextResponse.json({ ok: true, participant });
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { visitId?: string; participantId?: string };

  if (!body.visitId || !body.participantId) {
    return NextResponse.json({ ok: false, error: 'visitId and participantId are required' }, { status: 400 });
  }

  const auth = await authorize(request, body.visitId);
  if ('error' in auth) return auth.error;

  if (!auth.isHost) {
    return NextResponse.json({ ok: false, error: 'Only host can remove participants' }, { status: 403 });
  }

  const { error } = await auth.service
    .from('visit_participants')
    .delete()
    .eq('id', body.participantId)
    .eq('visit_id', body.visitId);

  if (error) {
    return NextResponse.json({ ok: false, error: `Could not remove participant: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
