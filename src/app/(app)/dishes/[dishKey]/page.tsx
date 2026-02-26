'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { Button } from '@/components/Button';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry } from '@/lib/supabase/types';
import { SignedPhoto } from '@/lib/photos/types';
import { uploadOriginalPhotoDirect } from '@/lib/photos/clientUpload';

function truncate(value: string, max = 100): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export default function DishProfilePage() {
  const params = useParams<{ dishKey: string }>();
  const [entries, setEntries] = useState<DishEntry[]>([]);
  const [photoByEntryId, setPhotoByEntryId] = useState<Record<string, SignedPhoto>>({});
  const [uploadingEntryId, setUploadingEntryId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const { data } = await supabase
      .from('dish_entries')
      .select('id,dish_name,price_original,price_usd,currency_original,identity_tag,comment,created_at,eaten_at,dish_key')
      .eq('dish_key', params.dishKey)
      .order('created_at', { ascending: true });

    const parsed = (data ?? []) as DishEntry[];
    setEntries(parsed);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token || parsed.length === 0) {
      setPhotoByEntryId({});
      return;
    }

    const ids = parsed.map((row) => row.id).join(',');
    const response = await fetch(`/api/photos/list?kind=dish&dish_entry_ids=${encodeURIComponent(ids)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!response.ok) {
      setPhotoByEntryId({});
      return;
    }

    const payload = (await response.json()) as { photos?: SignedPhoto[] };
    const map: Record<string, SignedPhoto> = {};
    for (const photo of payload.photos ?? []) {
      if (!photo.dish_entry_id) continue;
      if (!map[photo.dish_entry_id]) map[photo.dish_entry_id] = photo;
    }
    setPhotoByEntryId(map);
  }, [params.dishKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const trend = useMemo(() => {
    if (entries.length < 2) return null;
    const first = entries[0].price_usd ?? 0;
    const last = entries[entries.length - 1].price_usd ?? 0;
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    return { first, last, changePct };
  }, [entries]);

  const uploadDishPhoto = async (file: File, dishEntryId: string) => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) return;

    setUploadingEntryId(dishEntryId);
    try {
      const storageOriginal = await uploadOriginalPhotoDirect({ file, kind: 'dish' });
      const response = await fetch('/api/photos/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'dish',
          dish_entry_id: dishEntryId,
          storage_original: storageOriginal,
        }),
      });

      if (response.ok) {
        await load();
      }
    } finally {
      setUploadingEntryId(null);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <h1 className="text-xl font-semibold text-app-text">Dish recap</h1>

      {trend && (
        <div className="card-surface space-y-1 text-sm">
          <p className="text-app-muted">First price: ${trend.first.toFixed(2)}</p>
          <p className="text-app-muted">Latest price: ${trend.last.toFixed(2)}</p>
          <p className="text-app-text">Change: {trend.changePct.toFixed(1)}%</p>
        </div>
      )}

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && uploadTargetId) {
            void uploadDishPhoto(file, uploadTargetId);
          }
          event.currentTarget.value = '';
          setUploadTargetId(null);
        }}
      />

      {entries.length === 0 ? (
        <p className="empty-surface">No dish logs yet.</p>
      ) : (
        <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
          {entries.map((entry) => {
            const photo = photoByEntryId[entry.id];
            return (
              <div key={entry.id} className="px-3 py-3 text-sm">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {photo?.signedUrls.thumb ? (
                      <Image
                        src={photo.signedUrls.thumb}
                        alt={`${entry.dish_name} photo`}
                        width={64}
                        height={64}
                        className="h-14 w-14 rounded-lg object-cover"
                        unoptimized
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setUploadTargetId(entry.id);
                          uploadInputRef.current?.click();
                        }}
                        className="inline-flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-app-border text-[11px] text-app-muted"
                      >
                        {uploadingEntryId === entry.id ? '...' : 'Add pic'}
                      </button>
                    )}

                    <div>
                      <p className="font-medium text-app-text">{entry.dish_name}</p>
                      <p className="text-app-muted">${entry.price_original?.toFixed(2) ?? '--'}</p>
                    </div>
                  </div>

                  {entry.identity_tag && <IdentityTagPill tag={entry.identity_tag} />}
                </div>

                {entry.comment && <p className="text-xs text-app-muted">{truncate(entry.comment)}</p>}
                <p className="text-xs text-app-muted">{new Date(entry.eaten_at ?? entry.created_at).toLocaleString()}</p>
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setUploadTargetId(entry.id);
                      uploadInputRef.current?.click();
                    }}
                  >
                    {photo ? 'Replace photo' : 'Add photo'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}




