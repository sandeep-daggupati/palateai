import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/api/auth';
import {
  canUserAccessHangout,
  generateAndSaveHangoutCaption,
  getExistingHangoutCaption,
  saveUserCaption,
} from '@/lib/hangouts/caption';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

type CaptionRequest = {
  hangout_id?: string;
  entry_id?: string;
  caption_text?: string;
  force?: boolean;
};

async function resolveHangoutId(input: CaptionRequest): Promise<string | null> {
  if (input.hangout_id?.trim()) return input.hangout_id.trim();
  if (!input.entry_id?.trim()) return null;

  const service = getServiceSupabaseClient();
  const { data } = await service.from('dish_entries').select('hangout_id').eq('id', input.entry_id.trim()).maybeSingle();
  return data?.hangout_id ?? null;
}

export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const hangoutId = searchParams.get('hangout_id')?.trim();
  if (!hangoutId) {
    return NextResponse.json({ ok: false, error: 'hangout_id is required' }, { status: 400 });
  }

  const canAccess = await canUserAccessHangout(hangoutId, auth.userId);
  if (!canAccess) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  const caption = await getExistingHangoutCaption(hangoutId);
  return NextResponse.json({ ok: true, caption });
}

export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  let body: CaptionRequest;
  try {
    body = (await request.json()) as CaptionRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const hangoutId = await resolveHangoutId(body);
  if (!hangoutId) {
    return NextResponse.json({ ok: false, error: 'hangout_id or entry_id is required' }, { status: 400 });
  }

  const canAccess = await canUserAccessHangout(hangoutId, auth.userId);
  if (!canAccess) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  try {
    if (typeof body.caption_text === 'string') {
      const caption = await saveUserCaption(hangoutId, body.caption_text);
      return NextResponse.json({ ok: true, caption });
    }

    const caption = await generateAndSaveHangoutCaption(hangoutId, { force: body.force === true });
    return NextResponse.json({ ok: true, caption });
  } catch (error) {
    console.error('Failed to generate caption:', error);
    return NextResponse.json({ ok: false, error: 'Failed to generate caption' }, { status: 500 });
  }
}
