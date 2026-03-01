import { NextResponse } from 'next/server';
import { postProcessExtractedItems } from '@/lib/extraction/postprocess';
import { extractLineItemsFromImage, repairLineItemNamesText } from '@/lib/extraction/openaiVision';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { createHangoutSource, upsertHangoutItems } from '@/lib/data/hangoutsRepo';

type MappingRow = {
  raw_name: string;
  normalized_name: string;
  restaurant_id: string | null;
};

type LegacyUploadRow = {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  image_paths: string[];
  currency_detected: string | null;
  visited_at: string | null;
  created_at: string;
  visit_note: string | null;
  processed_at: string | null;
};

function firstNonEmptyPath(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    return first ?? null;
  }
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Extraction failed';
}

function sanitizePath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return `${parts.slice(0, 3).join('/')}/...`;
}

export async function POST(req: Request) {
  const supabase = getServiceSupabaseClient();
  let hangoutId: string | undefined;
  const traceId = Math.random().toString(36).slice(2, 10);

  try {
    const body = (await req.json()) as { uploadId?: string; hangoutId?: string };
    hangoutId = body.hangoutId ?? body.uploadId;

    if (!hangoutId) {
      return NextResponse.json({ ok: false, error: 'Missing hangoutId/uploadId' }, { status: 400 });
    }

    const hangoutIdValue = hangoutId;
    const { data: existingHangout } = await supabase
      .from('hangouts')
      .select('id,owner_user_id,restaurant_id,occurred_at,created_at,note')
      .eq('id', hangoutIdValue)
      .maybeSingle();

    let legacyUpload: LegacyUploadRow | null = null;
    if (!existingHangout) {
      const { data: upload } = await supabase
        .from('receipt_uploads')
        .select('id,user_id,restaurant_id,image_paths,currency_detected,visited_at,created_at,visit_note,processed_at')
        .eq('id', hangoutIdValue)
        .maybeSingle();
      legacyUpload = (upload as LegacyUploadRow | null) ?? null;
      if (!legacyUpload) {
        return NextResponse.json({ ok: false, error: 'Hangout not found' }, { status: 404 });
      }

      await supabase.from('hangouts').upsert(
        {
          id: legacyUpload.id,
          owner_user_id: legacyUpload.user_id,
          restaurant_id: legacyUpload.restaurant_id,
          occurred_at: legacyUpload.visited_at ?? legacyUpload.created_at,
          note: legacyUpload.visit_note,
        },
        { onConflict: 'id' },
      );
      await supabase.from('hangout_participants').upsert({ hangout_id: legacyUpload.id, user_id: legacyUpload.user_id }, { onConflict: 'hangout_id,user_id' });
    }

    const { data: hangout } = await supabase
      .from('hangouts')
      .select('id,owner_user_id,restaurant_id,occurred_at,created_at')
      .eq('id', hangoutIdValue)
      .single();
    if (!hangout) {
      throw new Error('Hangout not found after upsert');
    }

    const { data: sourceRows } = await supabase
      .from('hangout_sources')
      .select('*')
      .eq('hangout_id', hangoutIdValue)
      .eq('type', 'receipt')
      .order('created_at', { ascending: false })
      .limit(1);

    let receiptSource = (sourceRows?.[0] as { id: string; storage_path: string | null } | undefined) ?? null;

    if (!legacyUpload) {
      const { data: upload } = await supabase
        .from('receipt_uploads')
        .select('id,user_id,restaurant_id,image_paths,currency_detected,visited_at,created_at,visit_note,processed_at')
        .eq('id', hangoutIdValue)
        .maybeSingle();
      legacyUpload = (upload as LegacyUploadRow | null) ?? null;
    }

    const imagePath = firstNonEmptyPath(receiptSource?.storage_path ?? legacyUpload?.image_paths ?? null);
    if (!imagePath) {
      return NextResponse.json({ ok: false, error: 'No receipt image found for this hangout' }, { status: 400 });
    }

    if (!receiptSource) {
      receiptSource = await createHangoutSource(supabase, {
        hangout_id: hangoutIdValue,
        type: 'receipt',
        storage_path: imagePath,
        extractor: null,
        extracted_at: null,
        extraction_version: null,
        raw_extraction: null,
      });
    }

    console.info(`[extract:${traceId}] signedUrl.start`, { hangoutId: hangoutIdValue, imagePath: sanitizePath(imagePath) });
    const { data: signed, error: signedErr } = await supabase.storage.from('uploads').createSignedUrl(imagePath, 60);
    if (signedErr || !signed?.signedUrl) {
      throw new Error(signedErr?.message ?? 'Failed to create signed URL');
    }

    const restaurant = hangout.restaurant_id
      ? await supabase.from('restaurants').select('name,address').eq('id', hangout.restaurant_id).single()
      : { data: null, error: null };

    const [scopedMappingsResult, globalMappingsResult] = await Promise.all([
      hangout.restaurant_id
        ? supabase
            .from('dish_name_mappings')
            .select('raw_name,normalized_name,restaurant_id')
            .eq('user_id', hangout.owner_user_id)
            .eq('restaurant_id', hangout.restaurant_id)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('dish_name_mappings').select('raw_name,normalized_name,restaurant_id').eq('user_id', hangout.owner_user_id).is('restaurant_id', null),
    ]);

    const mappings = [
      ...((scopedMappingsResult.data ?? []) as MappingRow[]),
      ...((globalMappingsResult.data ?? []) as MappingRow[]),
    ];

    const extracted = await extractLineItemsFromImage({ imageUrl: signed.signedUrl, traceId });
    const restaurantName = (restaurant.data as { name?: string; address?: string } | null)?.name ?? null;
    const restaurantAddress = (restaurant.data as { name?: string; address?: string } | null)?.address ?? null;
    const restaurantContext = [restaurantName, restaurantAddress].filter(Boolean).join(' - ') || null;

    const processed = await postProcessExtractedItems({
      items: extracted.items,
      currency: extracted.currency ?? legacyUpload?.currency_detected ?? 'USD',
      mappings,
      restaurantContext,
      repairNames: async ({ flaggedRawNames, restaurantContext: ctx, allNames }) =>
        repairLineItemNamesText({
          traceId,
          flaggedRawNames,
          restaurantContext: ctx,
          allNames,
        }),
    });

    await supabase.from('hangout_items').delete().eq('hangout_id', hangoutIdValue).eq('source_id', receiptSource.id);

    const canonicalRows = processed.map((it) => ({
      source_id: receiptSource?.id ?? null,
      name_raw: it.name_raw,
      name_final: it.name_final,
      quantity: it.quantity ?? 1,
      unit_price: it.unit_price ?? it.price_final ?? null,
      currency: extracted.currency ?? legacyUpload?.currency_detected ?? 'USD',
      confidence: it.confidence,
      included: it.included,
    }));

    const savedRows = await upsertHangoutItems(supabase, hangoutIdValue, canonicalRows);

    await supabase
      .from('hangout_sources')
      .update({
        extractor: 'openai',
        extracted_at: new Date().toISOString(),
        extraction_version: 'v1',
      })
      .eq('id', receiptSource.id);

    // Legacy compatibility mirror (temporary).
    await supabase.from('extracted_line_items').delete().eq('upload_id', hangoutIdValue);
    if (processed.length) {
      await supabase.from('extracted_line_items').insert(
        processed.map((it) => ({
          upload_id: hangoutIdValue,
          name_raw: it.name_raw,
          price_raw: it.price_raw,
          name_final: it.name_final,
          price_final: it.price_final,
          confidence: it.confidence,
          included: it.included,
          quantity: it.quantity,
          unit_price: it.unit_price,
          group_key: it.group_key,
          grouped: it.grouped,
          duplicate_of: it.duplicate_of,
        })),
      );
    }

    if (legacyUpload) {
      await supabase.from('receipt_uploads').update({ processed_at: new Date().toISOString() }).eq('id', legacyUpload.id);
    }

    return NextResponse.json({ ok: true, count: savedRows.length, traceId });
  } catch (err: unknown) {
    const message = safeErrorMessage(err);
    console.error(`[extract:${traceId}] failed`, { hangoutId: hangoutId ?? null, error: message });
    return NextResponse.json({ ok: false, error: message, traceId }, { status: 500 });
  }
}
