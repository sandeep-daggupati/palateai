import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/supabase/types';
import { getDailyInsight } from '@/lib/insights/dailyAi';

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
    return { error: NextResponse.json({ error: 'Missing auth token' }, { status: 401 }) };
  }

  const anon = getAnonSupabaseClient();
  const {
    data: { user },
    error,
  } = await anon.auth.getUser(token);

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return { user };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;

  try {
    const insight = await getDailyInsight(auth.user.id);
    return NextResponse.json({
      insight: {
        insight_text: insight.insight_text,
        insight_type: insight.insight_type,
        generated_at: insight.generated_at,
        insight_date: insight.insight_date,
        metadata: insight.metadata,
        category: 'wildcard',
        evidence_type: 'summary',
        evidence: insight.metadata,
        expires_at: `${insight.insight_date}T23:59:59.000Z`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load insight.' }, { status: 500 });
  }
}
