'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { IdentityTagPill, identityTagOptions } from '@/components/IdentityTagPill';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, DishIdentityTag, ExtractedLineItem, ReceiptUpload, Restaurant } from '@/lib/supabase/types';

const QUICK_NOTE_CHIPS = ['Great value', 'Would repeat', 'Too salty', 'Spicy', 'Slow service', 'Amazing dessert'];
const VISIT_NOTE_MAX = 140;

type ReviewItem = ExtractedLineItem & {
  identity_tag: DishIdentityTag | null;
};

type VisitDish = Pick<DishEntry, 'id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment' | 'created_at' | 'eaten_at'>;

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function IdentitySelector({
  value,
  onChange,
}: {
  value: DishIdentityTag | null;
  onChange: (value: DishIdentityTag | null) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="section-label">How does this dish live in your world?</p>
      <div className="flex flex-wrap gap-2">
        {identityTagOptions().map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(active ? null : option.value)}
              className={`inline-flex h-10 items-center gap-1 rounded-full border px-3 text-xs font-semibold tracking-wide transition-colors duration-200 ${
                active
                  ? option.value === 'never_again'
                    ? 'border-rose-300/70 bg-rose-50/80 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                    : 'border-app-primary/40 bg-app-primary/10 text-app-primary'
                  : 'border-app-border bg-app-card text-app-muted hover:border-app-primary/40 hover:text-app-text'
              }`}
            >
              {active && (
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 10.5 8 14.5 16 6.5" />
                </svg>
              )}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function UploadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const uploadId = params.id;
  const [upload, setUpload] = useState<ReceiptUpload | null>(null);
  const [restaurant, setRestaurant] = useState<Pick<Restaurant, 'name' | 'address'> | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [visitDishes, setVisitDishes] = useState<VisitDish[]>([]);
  const [visitNote, setVisitNote] = useState('');
  const [openItemNotes, setOpenItemNotes] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const { data: uploadData } = await supabase.from('receipt_uploads').select('*').eq('id', uploadId).single();

    const typedUpload = uploadData as ReceiptUpload | null;
    setUpload(typedUpload);

    if (!typedUpload) {
      setRestaurant(null);
      setItems([]);
      setVisitDishes([]);
      setVisitNote('');
      return;
    }

    const [itemData, dishData, restaurantData] = await Promise.all([
      supabase.from('extracted_line_items').select('*').eq('upload_id', uploadId),
      supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,identity_tag,comment,created_at,eaten_at')
        .eq('source_upload_id', uploadId)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      typedUpload.restaurant_id
        ? supabase.from('restaurants').select('name,address').eq('id', typedUpload.restaurant_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const typedItems = (itemData.data ?? []) as ExtractedLineItem[];
    setItems(typedItems.map((item) => ({ ...item, identity_tag: null })));
    setVisitDishes((dishData.data ?? []) as VisitDish[]);
    setRestaurant((restaurantData.data ?? null) as Pick<Restaurant, 'name' | 'address'> | null);
    setVisitNote(typedUpload.visit_note ?? '');
  }, [uploadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runExtraction = async () => {
    await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
    await load();
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
        rating: null,
        comment: null,
        identity_tag: null,
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
        comment: item.comment,
      })),
    );

    await load();
  };

  const approve = async () => {
    if (saving) return;
    setSaving(true);

    try {
      const supabase = getBrowserSupabaseClient();
      const persisted = items.filter((item) => !item.id.startsWith('tmp-'));
      const unsaved = items.filter((item) => item.id.startsWith('tmp-'));

      await supabase
        .from('receipt_uploads')
        .update({
          visit_note: visitNote.trim() ? visitNote.trim() : null,
        })
        .eq('id', uploadId);

      const insertedReviewItems: ReviewItem[] = [];
      for (const item of unsaved) {
        const { data: inserted, error } = await supabase
          .from('extracted_line_items')
          .insert({
            upload_id: uploadId,
            name_raw: item.name_final ?? item.name_raw,
            name_final: item.name_final,
            price_raw: item.price_final,
            price_final: item.price_final,
            confidence: item.confidence,
            included: item.included,
            comment: item.comment,
          })
          .select('*')
          .single();

        if (error) throw error;
        insertedReviewItems.push({ ...(inserted as ExtractedLineItem), identity_tag: item.identity_tag });
      }

      await Promise.all(
        persisted.map((item) =>
          supabase
            .from('extracted_line_items')
            .update({
              name_final: item.name_final,
              price_final: item.price_final,
              included: item.included,
              comment: item.comment,
            })
            .eq('id', item.id),
        ),
      );

      const finalItems = [...persisted, ...insertedReviewItems];

      const approveResponse = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          identities: finalItems.map((item) => ({
            lineItemId: item.id,
            identityTag: item.identity_tag,
          })),
        }),
      });

      if (!approveResponse.ok) {
        throw new Error('Could not save approved dishes for this visit.');
      }

      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const appendVisitNoteChip = (chip: string) => {
    setVisitNote((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chip.slice(0, VISIT_NOTE_MAX);
      const next = `${trimmed}, ${chip}`;
      return next.slice(0, VISIT_NOTE_MAX);
    });
  };

  if (!upload) {
    return <div className="text-sm text-app-muted">Loading visit...</div>;
  }

  const visitDate = formatDate(upload.visited_at ?? upload.created_at);
  const isReviewable = upload.status === 'needs_review';
  const isApproved = upload.status === 'approved';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-8">
      <div className="card-surface space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-app-text">Visit details</h1>
          <StatusChip status={upload.status} />
        </div>
        <p className="text-base text-app-text">{restaurant?.name ?? 'Unknown restaurant'}</p>
        {restaurant?.address && <p className="text-sm text-app-muted">{restaurant.address}</p>}
        <p className="text-sm text-app-muted">{visitDate}</p>
        {visitNote && <p className="text-sm text-app-text">{visitNote}</p>}
        <p className="text-xs text-app-muted">Visit ID: {upload.id}</p>
      </div>

      {isReviewable ? (
        <div className="card-surface space-y-4">
          <h2 className="text-base font-semibold text-app-text">Review and approve</h2>

          <Button type="button" variant="secondary" onClick={runExtraction}>
            Run extraction
          </Button>

          <div className="rounded-2xl border border-app-border p-4 space-y-3">
            <div className="space-y-2">
              <label className="section-label">Visit note (optional)</label>
              <Input
                value={visitNote}
                maxLength={VISIT_NOTE_MAX}
                onChange={(e) => setVisitNote(e.target.value.slice(0, VISIT_NOTE_MAX))}
                placeholder="e.g., great vibe, too spicy, slow service"
              />
              <p className="text-xs text-app-muted">{visitNote.length}/{VISIT_NOTE_MAX}</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_NOTE_CHIPS.map((chip) => (
                  <Button
                    key={chip}
                    type="button"
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => appendVisitNoteChip(chip)}
                  >
                    {chip}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <h3 className="section-label">Dishes from this visit</h3>
          {items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-app-border p-4 text-sm text-app-muted">
              No extracted dishes yet. You can still save the visit note, then approve.
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item, index) => {
                const noteOpen = openItemNotes[item.id] || Boolean(item.comment);

                return (
                  <div key={item.id} className="rounded-2xl border border-app-border p-4 space-y-3">
                    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr,120px,84px]">
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
                      <label className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-app-border bg-app-card px-3 text-sm text-app-text">
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

                    <IdentitySelector
                      value={item.identity_tag}
                      onChange={(value) =>
                        setItems((prev) =>
                          prev.map((entry, itemIndex) =>
                            itemIndex === index ? { ...entry, identity_tag: value } : entry,
                          ),
                        )
                      }
                    />

                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        fullWidth={false}
                        className="h-8 px-1 text-xs underline underline-offset-2"
                        onClick={() =>
                          setOpenItemNotes((prev) => ({
                            ...prev,
                            [item.id]: !noteOpen,
                          }))
                        }
                      >
                        {noteOpen ? 'Hide dish note' : 'Add note'}
                      </Button>

                      {noteOpen && (
                        <Input
                          value={item.comment ?? ''}
                          maxLength={140}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((entry, itemIndex) =>
                                itemIndex === index ? { ...entry, comment: e.target.value } : entry,
                              ),
                            )
                          }
                          placeholder="Optional dish note"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <Button type="button" variant="secondary" onClick={addRow}>
              Add row
            </Button>
            <Button type="button" variant="secondary" onClick={saveNewRows}>
              Save added rows
            </Button>
            <Button type="button" onClick={approve} disabled={saving}>
              {saving ? 'Saving...' : 'Approve & Save'}
            </Button>
          </div>
        </div>
      ) : isApproved ? (
        <div className="card-surface space-y-3">
          <h2 className="section-label">Dishes from this visit</h2>
          {visitDishes.length === 0 ? (
            <p className="empty-surface">No dishes were saved for this visit.</p>
          ) : (
            visitDishes.map((dish) => (
              <Link key={dish.id} href={`/dishes/${dish.dish_key}`} className="rounded-2xl border border-app-border bg-app-card p-4 block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-medium text-app-text">{dish.dish_name}</p>
                  <IdentityTagPill tag={dish.identity_tag} />
                </div>
                {dish.comment && <p className="text-xs text-app-muted">{dish.comment}</p>}
                <p className="text-xs text-app-muted">{formatDate(dish.eaten_at ?? dish.created_at)}</p>
              </Link>
            ))
          )}
        </div>
      ) : (
        <div className="card-surface space-y-3">
          <h2 className="section-label">Visit is in progress</h2>
          <p className="text-sm text-app-muted">
            This visit has been saved and is waiting for extraction and review. Run extraction when you are ready.
          </p>
          <Button type="button" variant="secondary" onClick={runExtraction}>
            Run extraction
          </Button>
          {items.length > 0 && (
            <div className="space-y-2">
              <p className="section-label">Extracted dishes</p>
              {items
                .filter((item) => item.included)
                .map((item) => (
                  <div key={item.id} className="rounded-2xl border border-app-border bg-app-card p-4">
                    <p className="font-medium text-app-text">{item.name_final || item.name_raw}</p>
                    {item.comment && <p className="text-xs text-app-muted">{item.comment}</p>}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
