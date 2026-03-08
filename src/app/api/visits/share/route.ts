import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database, TableInsert, VisitParticipant } from '@/lib/supabase/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type CrewMember = VisitParticipant & {
  display_name: string | null;
  avatar_url: string | null;
};

type ProfileLookup = {
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

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
    return { error: NextResponse.json({ ok: false, error: 'Hangout not found' }, { status: 404 }) };
  }

  const isHost = visit.user_id === user.id;

  const { data: participantRow } = await service
    .from('visit_participants')
    .select('id,user_id,status')
    .eq('visit_id', visitId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  const isParticipant = Boolean(participantRow);

  return {
    service,
    user,
    visit,
    isHost,
    isParticipant,
  };
}

async function findUserByEmail(service: ReturnType<typeof getServiceSupabaseClient>, email: string) {
  let page = 1;
  const perPage = 200;

  while (page <= 25) {
    const response = await service.auth.admin.listUsers({ page, perPage });
    const users = response.data.users ?? [];

    const match = users.find((row) => row.email?.toLowerCase() === email);
    if (match) return match;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

function emailPrefix(email: string | null): string | null {
  if (!email) return null;
  const prefix = email.split('@')[0]?.trim();
  return prefix || null;
}

function metadataDisplayName(metadata: Record<string, unknown> | undefined, email: string | null): string | null {
  const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim() : '';
  if (fullName) return fullName;

  const name = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
  if (name) return name;

  const username = typeof metadata?.user_name === 'string' ? metadata.user_name.trim() : '';
  if (username) return username;

  return emailPrefix(email);
}

function metadataAvatar(metadata: Record<string, unknown> | undefined): string | null {
  const avatar = typeof metadata?.avatar_url === 'string' ? metadata.avatar_url.trim() : '';
  if (avatar) return avatar;

  const picture = typeof metadata?.picture === 'string' ? metadata.picture.trim() : '';
  return picture || null;
}

async function buildProfileLookup(service: ReturnType<typeof getServiceSupabaseClient>, userIds: string[]) {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) return new Map<string, ProfileLookup>();

  const { data: profileRows } = await service.from('profiles').select('id,display_name,avatar_url,email').in('id', uniqueIds);
  const lookup = new Map<string, ProfileLookup>();

  for (const row of profileRows ?? []) {
    lookup.set(row.id, {
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      email: row.email,
    });
  }

  for (const userId of uniqueIds) {
    const existing = lookup.get(userId) ?? { display_name: null, avatar_url: null, email: null };
    const adminResult = await service.auth.admin.getUserById(userId);
    const authUser = adminResult.data.user;
    const authEmail = authUser?.email?.toLowerCase() ?? null;
    const metadata = (authUser?.user_metadata ?? undefined) as Record<string, unknown> | undefined;

    const nextDisplayName = existing.display_name ?? metadataDisplayName(metadata, authEmail) ?? 'Crew member';
    const nextAvatar = existing.avatar_url ?? metadataAvatar(metadata);
    const nextEmail = existing.email ?? authEmail;

    lookup.set(userId, {
      display_name: nextDisplayName,
      avatar_url: nextAvatar,
      email: nextEmail,
    });

    if (!existing.display_name || !existing.avatar_url || !existing.email) {
      await service.from('profiles').upsert(
        {
          id: userId,
          display_name: existing.display_name ?? nextDisplayName,
          avatar_url: existing.avatar_url ?? nextAvatar,
          email: existing.email ?? nextEmail,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );
    }
  }

  return lookup;
}

async function attachDisplayNames(
  service: ReturnType<typeof getServiceSupabaseClient>,
  participants: VisitParticipant[],
): Promise<CrewMember[]> {
  const userIds = participants.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  const profileLookup = await buildProfileLookup(service, userIds);

  return participants.map((row) => {
    const profile = row.user_id ? profileLookup.get(row.user_id) : null;

    return {
      ...row,
      invited_email: null,
      display_name:
        profile?.display_name ??
        (row.status === 'invited' && !row.user_id ? 'Invite pending' : 'Crew member'),
      avatar_url: profile?.avatar_url ?? null,
    };
  });
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
    .in('status', ['active', 'invited'])
    .order('created_at', { ascending: true });

  const participants = (data ?? []) as VisitParticipant[];
  const crew = await attachDisplayNames(auth.service, participants);

  return NextResponse.json({ ok: true, participants: crew });
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
    return NextResponse.json({ ok: false, error: 'Only organizer can add crew' }, { status: 403 });
  }

  const matchedUser = await findUserByEmail(auth.service, email);

  if (matchedUser?.id === auth.user.id) {
    return NextResponse.json({ ok: false, error: 'Organizer is already in this hangout' }, { status: 400 });
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
        .update({ status: 'active', role: 'participant', invited_email: email })
        .eq('id', existingByUser.id)
        .select('id,visit_id,user_id,role,invited_email,status,created_at')
        .single();

      if (updateError) {
        return NextResponse.json({ ok: false, error: `Could not update crew member: ${updateError.message}` }, { status: 500 });
      }

      participant = updated as VisitParticipant;
    } else {
      const insertPayload: TableInsert<'visit_participants'> = {
        visit_id: body.visitId,
        user_id: matchedUser.id,
        invited_email: email,
        role: 'participant',
        status: 'active',
      };

      const { data: inserted, error: insertError } = await auth.service
        .from('visit_participants')
        .insert(insertPayload)
        .select('id,visit_id,user_id,role,invited_email,status,created_at')
        .single();

      if (insertError) {
        return NextResponse.json({ ok: false, error: `Could not add crew member: ${insertError.message}` }, { status: 500 });
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
        return NextResponse.json({ ok: false, error: `Could not invite buddy: ${insertError.message}` }, { status: 500 });
      }

      participant = inserted as VisitParticipant;
    }
  }

  await auth.service.from('receipt_uploads').update({ is_shared: true, share_visibility: 'private' }).eq('id', body.visitId);

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
    return NextResponse.json({ ok: false, error: 'Only organizer can remove buddies' }, { status: 403 });
  }

  const { error } = await auth.service.from('visit_participants').delete().eq('id', body.participantId).eq('visit_id', body.visitId);

  if (error) {
    return NextResponse.json({ ok: false, error: `Could not remove buddy: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

