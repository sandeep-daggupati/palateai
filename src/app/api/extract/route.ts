import { NextResponse } from 'next/server';
import { runExtractionStub } from '@/lib/extraction/extractor';

export async function POST(request: Request) {
  const body = (await request.json()) as { uploadId?: string };

  if (!body.uploadId) {
    return NextResponse.json({ ok: false, error: 'uploadId is required' }, { status: 400 });
  }

  await runExtractionStub({ uploadId: body.uploadId });

  return NextResponse.json({ ok: true });
}
