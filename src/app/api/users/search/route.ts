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

type UserSearchResult = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

async function searchUsersByEmail(service: ReturnType<typeof getServiceSupabaseClient>, query: string, currentUserId: string) {
  let page = 1;
  const perPage = 200;
  const matches: UserSearchResult[] = [];

  while (page <= 25 && matches.length < 8) {
    const response = await service.auth.admin.listUsers({ page, perPage });
    const users = response.data.users ?? [];

    for (const entry of users) {
      const email = entry.email?.toLowerCase();
      if (!email) continue;
      if (entry.id === currentUserId) continue;
      if (!email.includes(query)) continue;

      const metadata = (entry.user_metadata ?? {}) as Record<string, unknown>;
      const displayName =
        (typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '') ||
        (typeof metadata.name === 'string' ? metadata.name.trim() : '') ||
        (typeof metadata.user_name === 'string' ? metadata.user_name.trim() : '') ||
        null;
      const avatarUrl =
        (typeof metadata.avatar_url === 'string' ? metadata.avatar_url.trim() : '') ||
        (typeof metadata.picture === 'string' ? metadata.picture.trim() : '') ||
        null;
      matches.push({ id: entry.id, email: entry.email as string, display_name: displayName, avatar_url: avatarUrl });
      if (matches.length >= 8) break;
    }

    if (users.length < perPage) break;
    page += 1;
  }

  if (matches.length === 0) return matches;

  const profileIds = matches.map((row) => row.id);
  const { data: profileRows } = await service.from('profiles').select('id,display_name,avatar_url').in('id', profileIds);
  const profileLookup = new Map((profileRows ?? []).map((row) => [row.id, row]));

  return matches.map((row) => {
    const profile = profileLookup.get(row.id);
    return {
      ...row,
      display_name: profile?.display_name ?? row.display_name,
      avatar_url: profile?.avatar_url ?? row.avatar_url,
    };
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();

  if (query.length < 2) {
    return NextResponse.json({ ok: true, users: [] });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing auth token' }, { status: 401 });
  }

  const anon = getAnonSupabaseClient();
  const {
    data: { user },
  } = await anon.auth.getUser(token);

  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const service = getServiceSupabaseClient();
  const matched = await searchUsersByEmail(service, query, user.id);

  return NextResponse.json({ ok: true, users: matched });
}
