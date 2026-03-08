import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { ok: false, error: 'AI captions have been removed. Use vibe tags on the hangout page.' },
    { status: 410 },
  );
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'AI captions have been removed. Use vibe tags on the hangout page.' },
    { status: 410 },
  );
}
