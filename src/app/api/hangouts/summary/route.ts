import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/supabase/types';
import { getOrCreateHangoutSummary } from '@/lib/hangouts/summary';

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

async function authorize(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return { error: NextResponse.json({ ok: false, error: 'Missing auth token' }, { status: 401 }) };
  }

  const anon = getAnonSupabaseClient();
  const {
    data: { user },
    error,
  } = await anon.auth.getUser(token);

  if (error || !user) {
    return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  return { user };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const hangoutId = searchParams.get('hangoutId')?.trim();

  if (!hangoutId) {
    return NextResponse.json({ ok: false, error: 'hangoutId is required' }, { status: 400 });
  }

  try {
    const summary = await getOrCreateHangoutSummary(hangoutId, auth.user.id);
    if (!summary) {
      return NextResponse.json({ ok: false, error: 'Hangout not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error('Failed to load hangout summary:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load summary' }, { status: 500 });
  }
}
