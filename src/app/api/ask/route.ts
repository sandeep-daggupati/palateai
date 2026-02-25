import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/supabase/types';
import { AskRequestPayload, AskSource, PARSE_FALLBACK_MESSAGE } from '@/lib/ask/types';
import { routeAsk } from '@/lib/ask/router';

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

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;

  let body: AskRequestPayload;
  try {
    body = (await request.json()) as AskRequestPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const source: AskSource = body.source === 'canned' ? 'canned' : 'free_form';
  const question = typeof body.question === 'string' ? body.question.trim() : '';

  if (source === 'free_form' && !question) {
    return NextResponse.json({ error: 'Question is required.' }, { status: 400 });
  }

  if (source === 'canned' && !body.ask_intent) {
    return NextResponse.json({ error: 'ask_intent is required for canned requests.' }, { status: 400 });
  }

  try {
    const response = await routeAsk({
      question,
      source,
      cannedIntent: body.ask_intent,
      contextInput: body.context,
      userId: auth.user.id,
    });
    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      {
        answer: PARSE_FALLBACK_MESSAGE,
        meta: {
          intent: 'unsupported',
          confidence: 0,
          used_context: { restaurant: false, hangout: false },
          context_update: {
            lastRestaurantName: null,
            lastRestaurantId: null,
            lastHangoutId: null,
            lastDishName: null,
            lastIntent: 'unsupported',
          },
        },
      },
      { status: 200 },
    );
  }
}
