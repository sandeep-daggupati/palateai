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

async function searchUsersByEmail(service: ReturnType<typeof getServiceSupabaseClient>, query: string, currentUserId: string) {
  let page = 1;
  const perPage = 200;
  const matches: Array<{ id: string; email: string }> = [];

  while (page <= 25 && matches.length < 8) {
    const response = await service.auth.admin.listUsers({ page, perPage });
    const users = response.data.users ?? [];

    for (const entry of users) {
      const email = entry.email?.toLowerCase();
      if (!email) continue;
      if (entry.id === currentUserId) continue;
      if (!email.includes(query)) continue;

      matches.push({ id: entry.id, email: entry.email as string });
      if (matches.length >= 8) break;
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return matches;
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
