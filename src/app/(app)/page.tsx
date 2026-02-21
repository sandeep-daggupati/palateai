'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, ReceiptUpload } from '@/lib/supabase/types';

export default function HomePage() {
  const [uploads, setUploads] = useState<ReceiptUpload[]>([]);
  const [entries, setEntries] = useState<DishEntry[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();

      const { data: uploadData } = await supabase
        .from('receipt_uploads')
        .select('*')
        .eq('status', 'needs_review')
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: entryData } = await supabase
        .from('dish_entries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      setUploads((uploadData ?? []) as ReceiptUpload[]);
      setEntries((entryData ?? []) as DishEntry[]);
    };

    load();
  }, []);

  return (
    <div className="space-y-5 pb-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Needs review</h2>
        {uploads.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-500">No uploads waiting for review.</p>
        ) : (
          uploads.map((upload) => (
            <Link
              key={upload.id}
              href={`/uploads/${upload.id}`}
              className="block rounded-xl bg-white p-4 shadow-sm"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">Upload {upload.id.slice(0, 8)}</p>
                <StatusChip status={upload.status} />
              </div>
              <p className="text-xs text-slate-500">{new Date(upload.created_at).toLocaleString()}</p>
            </Link>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent dishes</h2>
        {entries.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-500">No dish entries yet.</p>
        ) : (
          entries.map((entry) => (
            <Link
              key={entry.id}
              href={`/dishes/${entry.dish_key}`}
              className="block rounded-xl bg-white p-4 shadow-sm"
            >
              <p className="font-medium">{entry.dish_name}</p>
              <p className="text-sm text-slate-600">${entry.price_original?.toFixed(2) ?? '—'}</p>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
