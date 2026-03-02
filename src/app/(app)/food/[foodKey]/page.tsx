'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { Button } from '@/components/Button';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishEntry } from '@/lib/supabase/types';
import { SignedPhoto } from '@/lib/photos/types';
import { deletePhoto, uploadDishPhoto as uploadDishPhotoRepo } from '@/lib/data/photosRepo';

function truncate(value: string, max = 100): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export default function FoodProfilePage() {
  const params = useParams<{ foodKey: string }>();
  const [entries, setEntries] = useState<DishEntry[]>([]);
  const [catalog, setCatalog] = useState<DishCatalog | null>(null);
  const [photosByEntryId, setPhotosByEntryId] = useState<Record<string, SignedPhoto[]>>({});
  const [uploadingEntryId, setUploadingEntryId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [lightboxPhotos, setLightboxPhotos] = useState<SignedPhoto[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? null);

    const { data } = await supabase
      .from('dish_entries')
      .select('id,dish_name,price_original,price_usd,currency_original,identity_tag,comment,created_at,eaten_at,dish_key,source_upload_id')
      .eq('dish_key', params.foodKey)
      .order('created_at', { ascending: true });

    const parsed = (data ?? []) as DishEntry[];
    setEntries(parsed);

    const { data: catalogData } = await supabase
      .from('dish_catalog')
      .select('*')
      .eq('dish_key', params.foodKey)
      .maybeSingle();
    setCatalog((catalogData ?? null) as DishCatalog | null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token || parsed.length === 0) {
      setPhotosByEntryId({});
      return;
    }

    const ids = parsed.map((row) => row.id).join(',');
    const response = await fetch(`/api/photos/list?kind=dish&dish_entry_ids=${encodeURIComponent(ids)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!response.ok) {
      setPhotosByEntryId({});
      return;
    }

    const payload = (await response.json()) as { photos?: SignedPhoto[] };
    const map: Record<string, SignedPhoto[]> = {};
    for (const photo of payload.photos ?? []) {
      if (!photo.dish_entry_id) continue;
      if (!map[photo.dish_entry_id]) map[photo.dish_entry_id] = [];
      map[photo.dish_entry_id].push(photo);
    }
    Object.keys(map).forEach((entryId) => {
      map[entryId] = map[entryId].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    });
    setPhotosByEntryId(map);
  }, [params.foodKey]);

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

  const uploadDishPhotoForEntry = async (file: File, dishEntryId: string) => {
    setUploadingEntryId(dishEntryId);
    try {
      const entry = entries.find((row) => row.id === dishEntryId);
      if (!entry) return;
      const photo = await uploadDishPhotoRepo(entry.source_upload_id, dishEntryId, file);
      if (photo) {
        await load();
      }
    } finally {
      setUploadingEntryId(null);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-app-text">{catalog?.name_canonical ?? entries[0]?.dish_name ?? 'Food recap'}</h1>
        {catalog?.description ? <p className="text-sm text-app-muted">{catalog.description}</p> : null}
      </div>

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
            void uploadDishPhotoForEntry(file, uploadTargetId);
          }
          event.currentTarget.value = '';
          setUploadTargetId(null);
        }}
      />

      {entries.length === 0 ? (
        <p className="empty-surface">No food logs yet.</p>
      ) : (
        <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
          {entries.map((entry) => {
            const photos = photosByEntryId[entry.id] ?? [];
            const cover = photos[0] ?? null;
            return (
              <div key={entry.id} className="px-3 py-3 text-sm">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {cover?.signedUrls.thumb ? (
                      <Image
                        src={cover.signedUrls.thumb}
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
                    {cover ? 'Add more photos' : 'Add photo'}
                  </Button>
                </div>
                {photos.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {photos.map((photo, index) => (
                      <div key={photo.id} className="relative overflow-hidden rounded-lg border border-app-border">
                        <button
                          type="button"
                          onClick={() => {
                            setLightboxPhotos(photos);
                            setLightboxIndex(index);
                          }}
                          className="block w-full"
                        >
                          {photo.signedUrls.thumb ? (
                            <Image src={photo.signedUrls.thumb} alt="Food photo" width={220} height={220} className="h-24 w-full object-cover" unoptimized />
                          ) : (
                            <div className="h-24 w-full bg-app-card" />
                          )}
                        </button>
                        {photo.user_id && currentUserId && photo.user_id === currentUserId && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await deletePhoto(photo.id);
                              if (ok) await load();
                            }}
                            className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lightboxPhotos.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => {
              setLightboxPhotos([]);
              setLightboxIndex(0);
            }}
          />
          <div className="relative z-10 w-full max-w-3xl p-3">
            <div className="relative overflow-hidden rounded-xl bg-black">
              {lightboxPhotos[lightboxIndex]?.signedUrls.original || lightboxPhotos[lightboxIndex]?.signedUrls.medium ? (
                <Image
                  src={lightboxPhotos[lightboxIndex].signedUrls.original ?? lightboxPhotos[lightboxIndex].signedUrls.medium ?? ''}
                  alt="Food photo"
                  width={1600}
                  height={1200}
                  className="max-h-[75vh] w-full object-contain"
                  unoptimized
                />
              ) : (
                <div className="h-72 w-full" />
              )}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth={false}
                className="h-9 px-2 text-xs"
                onClick={() => setLightboxIndex((prev) => (prev - 1 + lightboxPhotos.length) % lightboxPhotos.length)}
              >
                Prev
              </Button>
              <span className="text-xs text-white">
                {lightboxIndex + 1} / {lightboxPhotos.length}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth={false}
                className="h-9 px-2 text-xs"
                onClick={() => setLightboxIndex((prev) => (prev + 1) % lightboxPhotos.length)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


