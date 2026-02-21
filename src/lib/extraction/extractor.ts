import { getServiceSupabaseClient } from '@/lib/supabase/server';

interface ExtractionInput {
  uploadId: string;
}

const SAMPLE_ITEMS = [
  { name: 'Spicy Tuna Roll', price: 14.5, confidence: 0.92 },
  { name: 'Miso Ramen', price: 16, confidence: 0.88 },
  { name: 'Matcha Cheesecake', price: 9.5, confidence: 0.81 },
];

export async function runExtractionStub({ uploadId }: ExtractionInput) {
  const supabase = getServiceSupabaseClient();

  await supabase
    .from('receipt_uploads')
    .update({ status: 'processing' })
    .eq('id', uploadId);

  const { data: existingItems } = await supabase
    .from('extracted_line_items')
    .select('id')
    .eq('upload_id', uploadId)
    .limit(1);

  if (!existingItems || existingItems.length === 0) {
    await supabase.from('extracted_line_items').insert(
      SAMPLE_ITEMS.map((item) => ({
        upload_id: uploadId,
        name_raw: item.name,
        name_final: item.name,
        price_raw: item.price,
        price_final: item.price,
        confidence: item.confidence,
        included: true,
      })),
    );
  }

  await supabase
    .from('receipt_uploads')
    .update({
      status: 'needs_review',
      processed_at: new Date().toISOString(),
    })
    .eq('id', uploadId);
}
