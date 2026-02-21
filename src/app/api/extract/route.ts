// src/app/api/extract/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { extractLineItemsFromImage } from "@/lib/extraction/openaiVision";

export async function POST(req: Request) {
  try {
    const { uploadId } = await req.json();
    if (!uploadId) {
      return NextResponse.json({ ok: false, error: "Missing uploadId" }, { status: 400 });
    }

    // mark processing
    {
      const { error } = await supabaseServer
        .from("receipt_uploads")
        .update({ status: "processing" })
        .eq("id", uploadId);

      if (error) throw error;
    }

    // fetch upload row
    const { data: upload, error: uploadError } = await supabaseServer
      .from("receipt_uploads")
      .select("id,user_id,image_paths,currency_detected")
      .eq("id", uploadId)
      .single();

    if (uploadError) throw uploadError;

    const imagePath = Array.isArray(upload.image_paths) ? upload.image_paths[0] : null;
    if (!imagePath) {
      throw new Error("No image_paths found for upload");
    }

    // Create signed URL for private bucket download
    const { data: signed, error: signedErr } = await supabaseServer
      .storage
      .from("uploads")
      .createSignedUrl(imagePath, 60);

    if (signedErr) throw signedErr;
    if (!signed?.signedUrl) throw new Error("Failed to create signed URL");

    // Call OpenAI Vision
    const extracted = await extractLineItemsFromImage({ imageUrl: signed.signedUrl });

    // Clear any previous extracted line items (so reruns don't duplicate)
    await supabaseServer.from("extracted_line_items").delete().eq("upload_id", uploadId);

    // Insert extracted line items
    const rows = extracted.items.map((it) => ({
      upload_id: uploadId,
      name_raw: it.name,
      price_raw: it.price.toFixed(2),
      currency: extracted.currency ?? upload.currency_detected ?? null,
      name_final: it.name,
      price_final: it.price,
      confidence: 0.75, // heuristic for MVP; you can compute later
      user_edited: false,
      included: true,
    }));

    if (rows.length > 0) {
      const { error: insErr } = await supabaseServer.from("extracted_line_items").insert(rows);
      if (insErr) throw insErr;
    }

    // Mark needs_review
    const { error: doneErr } = await supabaseServer
      .from("receipt_uploads")
      .update({ status: "needs_review", processed_at: new Date().toISOString() })
      .eq("id", uploadId);

    if (doneErr) throw doneErr;

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (err: any) {
    // Best-effort set failed status
    try {
      const body = await req.json().catch(() => null);
      const uploadId = body?.uploadId;
      if (uploadId) {
        await supabaseServer.from("receipt_uploads").update({ status: "failed" }).eq("id", uploadId);
      }
    } catch {}

    return NextResponse.json(
      { ok: false, error: err?.message ?? "Extraction failed" },
      { status: 500 }
    );
  }
}