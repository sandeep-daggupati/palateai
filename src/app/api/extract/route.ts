// src/app/api/extract/route.ts
import { NextResponse } from "next/server";
import { postProcessExtractedItems } from "@/lib/extraction/postprocess";
import { extractLineItemsFromImage, repairLineItemNamesText } from "@/lib/extraction/openaiVision";
import { cleanupExtractedItems } from "@/lib/extraction/cleanup";
import { getServiceSupabaseClient } from "@/lib/supabase/server";
import { ensureDishCatalogEntry } from "@/lib/data/dishCatalog";
import { toDishKey } from "@/lib/utils";

type MappingRow = {
  raw_name: string;
  normalized_name: string;
  restaurant_id: string | null;
};

function firstNonEmptyPath(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((entry): entry is string => typeof entry === "string" && entry.length > 0);
    return first ?? null;
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}

function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Extraction failed";
}

function sanitizePath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return `${parts.slice(0, 3).join("/")}/...`;
}

function dedupeDishNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const cleaned = name.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export async function POST(req: Request) {
  const supabase = getServiceSupabaseClient();
  let uploadId: string | undefined;
  const traceId = Math.random().toString(36).slice(2, 10);

  try {
    const body = (await req.json()) as { uploadId?: string };
    uploadId = body.uploadId;

    console.info(`[extract:${traceId}] start`, { uploadId: uploadId ?? null });

    if (!uploadId) {
      console.warn(`[extract:${traceId}] missingUploadId`);
      return NextResponse.json({ ok: false, error: "Missing uploadId" }, { status: 400 });
    }

    const uploadIdValue = uploadId;

    {
      const { error } = await supabase.from("receipt_uploads").update({ status: "processing" }).eq("id", uploadIdValue);

      if (error) {
        console.error(`[extract:${traceId}] setProcessing.failed`, { error: error.message });
        throw error;
      }
      console.info(`[extract:${traceId}] setProcessing.ok`);
    }

    const { data: upload, error: uploadError } = await supabase
      .from("receipt_uploads")
      .select("id,user_id,restaurant_id,image_paths,currency_detected,visited_at,created_at,visit_note,processed_at")
      .eq("id", uploadIdValue)
      .single();

    if (uploadError) {
      console.error(`[extract:${traceId}] fetchUpload.failed`, { error: uploadError.message });
      throw uploadError;
    }

    const imagePath = firstNonEmptyPath(upload.image_paths);
    console.info(`[extract:${traceId}] uploadResolved`, {
      hasImagePaths: Array.isArray(upload.image_paths) && upload.image_paths.length > 0,
      selectedImagePath: imagePath ? sanitizePath(imagePath) : null,
    });

    if (!imagePath) {
      throw new Error("No image paths found for upload");
    }

    const { data: signed, error: signedErr } = await supabase.storage.from("uploads").createSignedUrl(imagePath, 60);

    if (signedErr) {
      console.error(`[extract:${traceId}] signedUrl.failed`, { error: signedErr.message, imagePath: sanitizePath(imagePath) });
      throw signedErr;
    }
    if (!signed?.signedUrl) {
      console.error(`[extract:${traceId}] signedUrl.missing`, { imagePath: sanitizePath(imagePath) });
      throw new Error("Failed to create signed URL");
    }

    const restaurant = upload.restaurant_id
      ? await supabase.from("restaurants").select("name,address").eq("id", upload.restaurant_id).single()
      : { data: null, error: null };

    if (restaurant.error) {
      console.warn(`[extract:${traceId}] restaurantLookup.failed`, { error: restaurant.error.message });
    }

    const [scopedMappingsResult, globalMappingsResult] = await Promise.all([
      upload.restaurant_id
        ? supabase
            .from("dish_name_mappings")
            .select("raw_name,normalized_name,restaurant_id")
            .eq("user_id", upload.user_id)
            .eq("restaurant_id", upload.restaurant_id)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("dish_name_mappings")
        .select("raw_name,normalized_name,restaurant_id")
        .eq("user_id", upload.user_id)
        .is("restaurant_id", null),
    ]);

    if (scopedMappingsResult.error) {
      console.warn(`[extract:${traceId}] scopedMappings.failed`, { error: scopedMappingsResult.error.message });
    }
    if (globalMappingsResult.error) {
      console.warn(`[extract:${traceId}] globalMappings.failed`, { error: globalMappingsResult.error.message });
    }

    const mappings = [
      ...((scopedMappingsResult.data ?? []) as MappingRow[]),
      ...((globalMappingsResult.data ?? []) as MappingRow[]),
    ];

    console.info(`[extract:${traceId}] signedUrl.ok`, {
      imagePath: sanitizePath(imagePath),
      mappingCount: mappings.length,
    });

    const extracted = await extractLineItemsFromImage({ imageUrl: signed.signedUrl, traceId });

    console.info(`[extract:${traceId}] openaiExtracted`, {
      itemCount: extracted.items.length,
      currency: extracted.currency,
    });

    const restaurantName = (restaurant.data as { name?: string; address?: string } | null)?.name ?? null;
    const restaurantAddress = (restaurant.data as { name?: string; address?: string } | null)?.address ?? null;
    const restaurantContext = [restaurantName, restaurantAddress].filter(Boolean).join(" - ") || null;

    const processed = await postProcessExtractedItems({
      items: extracted.items,
      currency: extracted.currency ?? upload.currency_detected,
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

    const cleaned = cleanupExtractedItems(processed, { restaurantContext });

    const { error: deleteErr } = await supabase.from("extracted_line_items").delete().eq("upload_id", uploadIdValue);

    if (deleteErr) {
      console.error(`[extract:${traceId}] clearExisting.failed`, { error: deleteErr.message });
      throw deleteErr;
    }

    const rows = cleaned.map((it) => ({
      upload_id: uploadIdValue,
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
    }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("extracted_line_items").insert(rows);
      if (insErr) {
        console.error(`[extract:${traceId}] insertRows.failed`, {
          error: insErr.message,
          rowCount: rows.length,
        });
        throw insErr;
      }
      console.info(`[extract:${traceId}] insertRows.ok`, { rowCount: rows.length });
    } else {
      console.warn(`[extract:${traceId}] insertRows.skipped`, { reason: "no_items_after_cleaning" });
    }

    // Canonical write path: ensure hangout + receipt source + shared hangout items.
    const { error: hangoutUpsertError } = await supabase.from("hangouts").upsert({
      id: uploadIdValue,
      owner_user_id: upload.user_id,
      restaurant_id: upload.restaurant_id,
      occurred_at: upload.visited_at ?? upload.created_at,
      note: upload.visit_note ?? null,
    });
    if (hangoutUpsertError) {
      console.warn(`[extract:${traceId}] hangoutUpsert.failed`, { error: hangoutUpsertError.message });
    } else {
      await supabase.from("hangout_participants").upsert(
        { hangout_id: uploadIdValue, user_id: upload.user_id },
        { onConflict: "hangout_id,user_id" },
      );
    }

    const { data: existingSource } = await supabase
      .from("hangout_sources")
      .select("id")
      .eq("hangout_id", uploadIdValue)
      .eq("type", "receipt")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let sourceId = existingSource?.id ?? null;
    if (!sourceId) {
      const { data: insertedSource, error: sourceInsertError } = await supabase
        .from("hangout_sources")
        .insert({
          hangout_id: uploadIdValue,
          type: "receipt",
          storage_path: imagePath,
          extractor: "openai",
          extracted_at: new Date().toISOString(),
          extraction_version: "v1",
          raw_extraction: null,
        })
        .select("id")
        .single();
      if (sourceInsertError) {
        console.warn(`[extract:${traceId}] sourceInsert.failed`, { error: sourceInsertError.message });
      } else {
        sourceId = insertedSource.id;
      }
    }

    if (sourceId) {
      const { data: receiptSources } = await supabase
        .from("hangout_sources")
        .select("id")
        .eq("hangout_id", uploadIdValue)
        .eq("type", "receipt");
      const receiptSourceIds = (receiptSources ?? []).map((row) => row.id).filter(Boolean);
      if (receiptSourceIds.length > 0) {
        await supabase.from("hangout_items").delete().eq("hangout_id", uploadIdValue).in("source_id", receiptSourceIds);
      } else {
        await supabase.from("hangout_items").delete().eq("hangout_id", uploadIdValue).eq("source_id", sourceId);
      }
      if (cleaned.length > 0) {
        const canonicalRows = cleaned.map((it) => ({
          hangout_id: uploadIdValue,
          source_id: sourceId,
          name_raw: it.name_raw,
          name_final: it.name_final,
          quantity: Math.max(1, it.quantity ?? 1),
          unit_price: it.unit_price ?? it.price_final ?? null,
          currency: extracted.currency ?? upload.currency_detected ?? "USD",
          confidence: it.confidence,
          included: it.included,
        }));
        const { error: canonicalInsertErr } = await supabase.from("hangout_items").insert(canonicalRows);
        if (canonicalInsertErr) {
          console.warn(`[extract:${traceId}] canonicalInsert.failed`, { error: canonicalInsertErr.message });
        }
      }
    }

    const restaurantNameForKey = restaurantName ?? "unknown-restaurant";
    const catalogDishNames = dedupeDishNames(
      cleaned
        .filter((item) => item.included)
        .map((item) => item.name_final || item.name_raw),
    );

    if (catalogDishNames.length > 0) {
      await Promise.all(
        catalogDishNames.map(async (dishName) => {
          try {
            await ensureDishCatalogEntry({
              dishKey: toDishKey(`${restaurantNameForKey} ${dishName}`),
              dishName,
              restaurantName,
            });
          } catch (error) {
            console.warn(`[extract:${traceId}] dishCatalog.failed`, {
              dishName,
              error: error instanceof Error ? error.message : "Unknown dish catalog error",
            });
          }
        }),
      );
    }

    const { error: doneErr } = await supabase
      .from("receipt_uploads")
      .update({ status: "needs_review", processed_at: new Date().toISOString() })
      .eq("id", uploadIdValue);

    if (doneErr) {
      console.error(`[extract:${traceId}] finalize.failed`, { error: doneErr.message });
      throw doneErr;
    }

    console.info(`[extract:${traceId}] done`, { uploadId: uploadIdValue, inserted: rows.length });
    return NextResponse.json({ ok: true, count: rows.length, traceId });
  } catch (err: unknown) {
    if (uploadId) {
      const { error: failErr } = await supabase.from("receipt_uploads").update({ status: "failed" }).eq("id", uploadId);

      if (failErr) {
        console.error(`[extract:${traceId}] markFailed.failed`, {
          uploadId,
          error: failErr.message,
        });
      }
    }

    const message = safeErrorMessage(err);
    console.error(`[extract:${traceId}] failed`, { uploadId: uploadId ?? null, error: message });
    return NextResponse.json({ ok: false, error: message, traceId }, { status: 500 });
  }
}
