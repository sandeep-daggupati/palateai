// src/app/api/extract/route.ts
import { NextResponse } from "next/server";
import { getServiceSupabaseClient } from "@/lib/supabase/server";
import { extractLineItemsFromImage } from "@/lib/extraction/openaiVision";

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
      const { error } = await supabase
        .from("receipt_uploads")
        .update({ status: "processing" })
        .eq("id", uploadIdValue);

      if (error) {
        console.error(`[extract:${traceId}] setProcessing.failed`, { error: error.message });
        throw error;
      }
      console.info(`[extract:${traceId}] setProcessing.ok`);
    }

    const { data: upload, error: uploadError } = await supabase
      .from("receipt_uploads")
      .select("id,user_id,image_paths,dish_image_path,currency_detected")
      .eq("id", uploadIdValue)
      .single();

    if (uploadError) {
      console.error(`[extract:${traceId}] fetchUpload.failed`, { error: uploadError.message });
      throw uploadError;
    }

    const imagePath = firstNonEmptyPath(upload.image_paths) ?? firstNonEmptyPath(upload.dish_image_path);
    console.info(`[extract:${traceId}] uploadResolved`, {
      hasImagePaths: Array.isArray(upload.image_paths) && upload.image_paths.length > 0,
      hasDishImagePath: typeof upload.dish_image_path === "string" && upload.dish_image_path.length > 0,
      selectedImagePath: imagePath ? sanitizePath(imagePath) : null,
    });

    if (!imagePath) {
      throw new Error("No image paths found for upload");
    }

    const { data: signed, error: signedErr } = await supabase.storage
      .from("uploads")
      .createSignedUrl(imagePath, 60);

    if (signedErr) {
      console.error(`[extract:${traceId}] signedUrl.failed`, { error: signedErr.message, imagePath: sanitizePath(imagePath) });
      throw signedErr;
    }
    if (!signed?.signedUrl) {
      console.error(`[extract:${traceId}] signedUrl.missing`, { imagePath: sanitizePath(imagePath) });
      throw new Error("Failed to create signed URL");
    }

    console.info(`[extract:${traceId}] signedUrl.ok`, {
      imagePath: sanitizePath(imagePath),
    });

    const extracted = await extractLineItemsFromImage({ imageUrl: signed.signedUrl, traceId });

    console.info(`[extract:${traceId}] openaiExtracted`, {
      itemCount: extracted.items.length,
      currency: extracted.currency,
    });

    const { error: deleteErr } = await supabase
      .from("extracted_line_items")
      .delete()
      .eq("upload_id", uploadIdValue);

    if (deleteErr) {
      console.error(`[extract:${traceId}] clearExisting.failed`, { error: deleteErr.message });
      throw deleteErr;
    }

    const rows = extracted.items.map((it) => ({
      upload_id: uploadIdValue,
      name_raw: it.name,
      price_raw: it.price,
      name_final: it.name,
      price_final: it.price,
      confidence: 0.75,
      included: true,
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
      const { error: failErr } = await supabase
        .from("receipt_uploads")
        .update({ status: "failed" })
        .eq("id", uploadId);

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
