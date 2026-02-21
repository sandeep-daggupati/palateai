'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { ExtractedLineItem, ReceiptUpload } from '@/lib/supabase/types';

export default function UploadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const uploadId = params.id;
  const [upload, setUpload] = useState<ReceiptUpload | null>(null);
  const [items, setItems] = useState<ExtractedLineItem[]>([]);

  const load = async () => {
    const supabase = getBrowserSupabaseClient();
    const { data: uploadData } = await supabase.from('receipt_uploads').select('*').eq('id', uploadId).single();
    const { data: itemData } = await supabase.from('extracted_line_items').select('*').eq('upload_id', uploadId);
    setUpload(uploadData as ReceiptUpload | null);
    setItems((itemData ?? []) as ExtractedLineItem[]);
  };

  useEffect(() => {
    load();
  }, [uploadId]);

  const runExtraction = async () => {
    await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
    await load();
  };

  const approve = async () => {
    await Promise.all(
      items.map((item) =>
        getBrowserSupabaseClient()
          .from('extracted_line_items')
          .update({
            name_final: item.name_final,
            price_final: item.price_final,
            included: item.included,
          })
          .eq('id', item.id),
      ),
    );

    await fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
    router.push('/');
    router.refresh();
  };

  const addRow = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        upload_id: uploadId,
        name_raw: '',
        name_final: '',
        price_raw: null,
        price_final: null,
        confidence: 1,
        included: true,
        created_at: new Date().toISOString(),
      },
    ]);
  };

  const saveNewRows = async () => {
    const supabase = getBrowserSupabaseClient();
    const unsaved = items.filter((item) => item.id.startsWith('tmp-'));

    if (!unsaved.length) return;

    await supabase.from('extracted_line_items').insert(
      unsaved.map((item) => ({
        upload_id: uploadId,
        name_raw: item.name_final ?? item.name_raw,
        name_final: item.name_final,
        price_raw: item.price_final,
        price_final: item.price_final,
        confidence: item.confidence,
        included: item.included,
      })),
    );

    await load();
  };

  if (!upload) {
    return <div className="text-sm text-slate-500">Loading upload…</div>;
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-xl bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Upload details</h1>
          <StatusChip status={upload.status} />
        </div>
        <p className="text-xs text-slate-500">ID: {upload.id}</p>
        {upload.image_paths.map((path) => (
          <p key={path} className="text-xs break-all text-slate-600">{path}</p>
        ))}
        <Button type="button" onClick={runExtraction} className="bg-blue-600 hover:bg-blue-500">
          Run extraction
        </Button>
      </div>

      {upload.status === 'needs_review' && (
        <div className="rounded-xl bg-white p-4 shadow-sm space-y-3">
          <h2 className="font-semibold">Review line items</h2>
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={item.id} className="grid grid-cols-[1fr,110px,72px] gap-2 items-center">
                <Input
                  value={item.name_final ?? ''}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((entry, itemIndex) =>
                        itemIndex === index ? { ...entry, name_final: e.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="Dish name"
                />
                <Input
                  type="number"
                  value={item.price_final ?? ''}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((entry, itemIndex) =>
                        itemIndex === index
                          ? { ...entry, price_final: Number.parseFloat(e.target.value) || null }
                          : entry,
                      ),
                    )
                  }
                  placeholder="Price"
                />
                <label className="text-xs flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={item.included}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((entry, itemIndex) =>
                          itemIndex === index ? { ...entry, included: e.target.checked } : entry,
                        ),
                      )
                    }
                  />
                  Include
                </label>
              </div>
            ))}
          </div>
          <Button type="button" onClick={addRow} className="bg-slate-600 hover:bg-slate-500">
            Add row
          </Button>
          <Button type="button" onClick={saveNewRows} className="bg-indigo-600 hover:bg-indigo-500">
            Save added rows
          </Button>
          <Button type="button" onClick={approve}>
            Approve & Save
          </Button>
        </div>
      )}
    </div>
  );
}



