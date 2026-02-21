// src/app/api/extract/route.ts
import { NextResponse } from "next/server";
import { getServiceSupabaseClient } from "@/lib/supabase/server";
import { extractLineItemsFromImage } from "@/lib/extraction/openaiVision";

export async function POST(req: Request) {
  const supabase = getServiceSupabaseClient();
  let uploadId: string | undefined;

  try {
    const body = (await req.json()) as { uploadId?: string };
    uploadId = body.uploadId;

    if (!uploadId) {
      return NextResponse.json({ ok: false, error: "Missing uploadId" }, { status: 400 });
    }

    const uploadIdValue = uploadId;

    // mark processing
    {
      const { error } = await supabase
        .from("receipt_uploads")
        .update({ status: "processing" })
        .eq("id", uploadIdValue);

      if (error) throw error;
    }

    // fetch upload row
    const { data: upload, error: uploadError } = await supabase
      .from("receipt_uploads")
      .select("id,user_id,image_paths,currency_detected")
      .eq("id", uploadIdValue)
      .single();

    if (uploadError) throw uploadError;

    const imagePath = Array.isArray(upload.image_paths) ? upload.image_paths[0] : null;
    if (!imagePath) {
      throw new Error("No image_paths found for upload");
    }

    // Create signed URL for private bucket download
    const { data: signed, error: signedErr } = await supabase.storage
      .from("uploads")
      .createSignedUrl(imagePath, 60);

    if (signedErr) throw signedErr;
    if (!signed?.signedUrl) throw new Error("Failed to create signed URL");

    // Call OpenAI Vision
    const extracted = await extractLineItemsFromImage({ imageUrl: signed.signedUrl });

    // Clear any previous extracted line items (so reruns don't duplicate)
    await supabase.from("extracted_line_items").delete().eq("upload_id", uploadIdValue);

    // Insert extracted line items
    const rows = extracted.items.map((it) => ({
      upload_id: uploadIdValue,
      name_raw: it.name,
      price_raw: it.price,
      name_final: it.name,
      price_final: it.price,
      confidence: 0.75, // heuristic for MVP; you can compute later
      included: true,
    }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("extracted_line_items").insert(rows);
      if (insErr) throw insErr;
    }

    // Mark needs_review
    const { error: doneErr } = await supabase
      .from("receipt_uploads")
      .update({ status: "needs_review", processed_at: new Date().toISOString() })
      .eq("id", uploadIdValue);

    if (doneErr) throw doneErr;

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (err: unknown) {
    // Best-effort set failed status
    if (uploadId) {
      await supabase.from("receipt_uploads").update({ status: "failed" }).eq("id", uploadId);
    }

    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
