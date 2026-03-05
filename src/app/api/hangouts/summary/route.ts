import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/api/auth';
import { canUserAccessHangout, getExistingHangoutCaption } from '@/lib/hangouts/caption';

export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const hangoutId = searchParams.get('hangoutId')?.trim();

  if (!hangoutId) {
    return NextResponse.json({ ok: false, error: 'hangoutId is required' }, { status: 400 });
  }

  try {
    const canAccess = await canUserAccessHangout(hangoutId, auth.userId);
    if (!canAccess) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    const summary = await getExistingHangoutCaption(hangoutId);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error('Failed to load hangout summary:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load summary' }, { status: 500 });
  }
}
