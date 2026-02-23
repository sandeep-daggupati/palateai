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
  const users = await service.auth.admin.listUsers({ page: 1, perPage: 500 });

  const matched = users.data.users
    .filter((entry) => entry.email && entry.email.toLowerCase().includes(query) && entry.id !== user.id)
    .slice(0, 8)
    .map((entry) => ({ id: entry.id, email: entry.email as string }));

  return NextResponse.json({ ok: true, users: matched });
}
