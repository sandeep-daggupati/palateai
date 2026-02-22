'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { identityTagOptions } from '@/components/IdentityTagPill';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishIdentityTag, ExtractedLineItem, ReceiptUpload } from '@/lib/supabase/types';

const QUICK_NOTE_CHIPS = ['Great value', 'Would repeat', 'Too salty', 'Spicy', 'Slow service', 'Amazing dessert'];
const VISIT_NOTE_MAX = 140;

type ReviewItem = ExtractedLineItem & {
  identity_tag: DishIdentityTag | null;
};

function IdentitySelector({
  value,
  onChange,
}: {
  value: DishIdentityTag | null;
  onChange: (value: DishIdentityTag | null) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-app-muted">How does this dish live in your world?</p>
      <div className="flex flex-wrap gap-2">
        {identityTagOptions().map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(active ? null : option.value)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide transition-colors ${
                active
                  ? option.value === 'never_again'
                    ? 'border-rose-300/70 bg-rose-50/80 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                    : 'border-app-primary/40 bg-app-primary/10 text-app-primary'
                  : 'border-app-border bg-app-card text-app-muted hover:border-app-primary/40 hover:text-app-text'
              }`}
            >
              {active && <span aria-hidden="true">?</span>}
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
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [visitNote, setVisitNote] = useState('');
  const [openItemNotes, setOpenItemNotes] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const { data: uploadData } = await supabase.from('receipt_uploads').select('*').eq('id', uploadId).single();
    const { data: itemData } = await supabase.from('extracted_line_items').select('*').eq('upload_id', uploadId);

    const typedUpload = uploadData as ReceiptUpload | null;
    const typedItems = (itemData ?? []) as ExtractedLineItem[];

    setUpload(typedUpload);
    setItems(typedItems.map((item) => ({ ...item, identity_tag: null })));
    setVisitNote(typedUpload?.visit_note ?? '');
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

      await fetch('/api/approve', {
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

      router.push('/');
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
    return <div className="text-sm text-app-muted">Loading upload...</div>;
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="card-surface space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Upload details</h1>
          <StatusChip status={upload.status} />
        </div>
        <p className="text-xs text-app-muted">ID: {upload.id}</p>
        {upload.image_paths.map((path) => (
          <p key={path} className="text-xs break-all text-app-muted">
            {path}
          </p>
        ))}
        <Button type="button" onClick={runExtraction} className="bg-blue-600 hover:bg-blue-500">
          Run extraction
        </Button>
      </div>

      {upload.status === 'needs_review' && (
        <div className="card-surface space-y-4">
          <h2 className="font-semibold">Review and feedback</h2>

          <div className="rounded-lg border border-app-border p-3 space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-app-muted">Quick note (optional)</label>
              <Input
                value={visitNote}
                maxLength={VISIT_NOTE_MAX}
                onChange={(e) => setVisitNote(e.target.value.slice(0, VISIT_NOTE_MAX))}
                placeholder="e.g., great vibe, too spicy, slow service"
              />
              <p className="text-[11px] text-app-muted">{visitNote.length}/{VISIT_NOTE_MAX}</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_NOTE_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => appendVisitNoteChip(chip)}
                    className="rounded-full border border-app-border bg-app-card px-3 py-1 text-xs text-app-text"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <h3 className="text-sm font-semibold text-app-text">Line items</h3>
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-app-border p-3 text-sm text-app-muted">
              No extracted dishes yet. You can still save visit note, then approve.
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item, index) => {
                const noteOpen = openItemNotes[item.id] || Boolean(item.comment);

                return (
                  <div key={item.id} className="rounded-lg border border-app-border p-3 space-y-3">
                    <div className="grid grid-cols-[1fr,100px,72px] gap-2 items-center">
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
                      <button
                        type="button"
                        onClick={() =>
                          setOpenItemNotes((prev) => ({
                            ...prev,
                            [item.id]: !noteOpen,
                          }))
                        }
                        className="text-xs font-medium text-app-text underline underline-offset-2"
                      >
                        {noteOpen ? 'Hide dish note' : 'Add note'}
                      </button>

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

          <div className="flex flex-col gap-2">
            <Button type="button" onClick={addRow} className="bg-slate-600 hover:bg-slate-500">
              Add row
            </Button>
            <Button type="button" onClick={saveNewRows} className="bg-indigo-600 hover:bg-indigo-500">
              Save added rows
            </Button>
            <Button type="button" onClick={approve} disabled={saving}>
              {saving ? 'Saving...' : 'Approve & Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

