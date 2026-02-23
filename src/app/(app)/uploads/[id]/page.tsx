'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { IdentityTagPill, identityTagOptions } from '@/components/IdentityTagPill';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, DishIdentityTag, ExtractedLineItem, ReceiptUpload, Restaurant, VisitParticipant } from '@/lib/supabase/types';
import { toDishKey } from '@/lib/utils';

const QUICK_NOTE_CHIPS = ['Great value', 'Would repeat', 'Too salty', 'Spicy', 'Slow service', 'Amazing dessert'];
const VISIT_NOTE_MAX = 140;

type ReviewItem = ExtractedLineItem & {
  identity_tag: DishIdentityTag | null;
};

type VisitDish = Pick<DishEntry, 'id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment' | 'created_at' | 'eaten_at' | 'user_id'>;

type PersonalDishDraft = {
  dish_key: string;
  dish_name: string;
  price: number | null;
  identity_tag: DishIdentityTag | null;
  comment: string;
  had_it: boolean;
};

type ShareUserSuggestion = {
  id: string;
  email: string;
};

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPrice(value: number | null): string {
  if (value == null) return 'Price unavailable';
  return `$${value.toFixed(2)}`;
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
      <p className="section-label">Identity</p>
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
                    ? 'border-rose-500 bg-rose-100 text-rose-800 outline outline-2 outline-offset-2 outline-rose-500 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-200 dark:outline-rose-400'
                    : 'border-app-border bg-app-card text-app-text shadow-sm'
                  : 'border-app-border bg-app-card text-app-muted hover:bg-app-card/80 hover:text-app-text'
              }`}
            >
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

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [upload, setUpload] = useState<ReceiptUpload | null>(null);
  const [restaurant, setRestaurant] = useState<Pick<Restaurant, 'name' | 'address'> | null>(null);

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [visitDishes, setVisitDishes] = useState<VisitDish[]>([]);
  const [personalDrafts, setPersonalDrafts] = useState<PersonalDishDraft[]>([]);

  const [visitNote, setVisitNote] = useState('');
  const [openItemNotes, setOpenItemNotes] = useState<Record<string, boolean>>({});

  const [participants, setParticipants] = useState<VisitParticipant[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuggestions, setShareSuggestions] = useState<ShareUserSuggestion[]>([]);
  const [shareSuggestLoading, setShareSuggestLoading] = useState(false);
  const [shareFocused, setShareFocused] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savingExperience, setSavingExperience] = useState(false);
  const didAutoExtractRef = useRef(false);

  const isHost = Boolean(upload && currentUserId && upload.user_id === currentUserId);

  const isActiveParticipant = useMemo(
    () => Boolean(currentUserId && participants.some((row) => row.user_id === currentUserId && row.status === 'active')),
    [currentUserId, participants],
  );

  const canViewVisit = isHost || isActiveParticipant;
  const hasAnyExtractedItems = items.some((item) => item.included);
  const hasAnySavedVisitDishes = visitDishes.length > 0;
  const showExtractionPrompt = Boolean(
    isHost && upload && upload.status !== 'needs_review' && !hasAnyExtractedItems && !hasAnySavedVisitDishes,
  );

  const getAuthHeader = useCallback(async (): Promise<Record<string, string>> => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const loadParticipants = useCallback(async () => {
    const headers = await getAuthHeader();
    const response = await fetch(`/api/visits/share?visitId=${encodeURIComponent(uploadId)}`, { headers });

    if (!response.ok) {
      setParticipants([]);
      return;
    }

    const payload = (await response.json()) as { participants?: VisitParticipant[] };
    setParticipants(payload.participants ?? []);
  }, [getAuthHeader, uploadId]);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    setCurrentUserId(user?.id ?? null);

    const { data: uploadData } = await supabase.from('receipt_uploads').select('*').eq('id', uploadId).single();

    const typedUpload = uploadData as ReceiptUpload | null;
    setUpload(typedUpload);

    if (!typedUpload || !user) {
      setRestaurant(null);
      setItems([]);
      setVisitDishes([]);
      setPersonalDrafts([]);
      setVisitNote('');
      setParticipants([]);
      return;
    }

    const [itemData, dishData, personalEntryData, restaurantData] = await Promise.all([
      supabase.from('extracted_line_items').select('*').eq('upload_id', uploadId),
      supabase
        .from('dish_entries')
        .select('id,user_id,dish_name,dish_key,identity_tag,comment,created_at,eaten_at')
        .eq('source_upload_id', uploadId)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('dish_entries')
        .select('dish_name,dish_key,identity_tag,comment,had_it,price_original')
        .eq('source_upload_id', uploadId)
        .eq('user_id', user.id),
      typedUpload.restaurant_id
        ? supabase.from('restaurants').select('name,address').eq('id', typedUpload.restaurant_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const typedItems = (itemData.data ?? []) as ExtractedLineItem[];
    const typedVisitDishes = (dishData.data ?? []) as VisitDish[];
    const personalEntries = (personalEntryData.data ?? []) as Array<
      Pick<DishEntry, 'dish_name' | 'dish_key' | 'identity_tag' | 'comment' | 'had_it' | 'price_original'>
    >;

    const restaurantName = (restaurantData.data as Pick<Restaurant, 'name' | 'address'> | null)?.name ?? 'unknown-restaurant';

    const baseDishes =
      typedItems.filter((item) => item.included).map((item) => ({
        dish_name: item.name_final || item.name_raw,
        dish_key: toDishKey(`${restaurantName} ${item.name_final || item.name_raw}`),
        price: item.price_final,
      })) || [];

    const fallbackFromVisitDishes = typedVisitDishes
      .filter((dish) => dish.user_id === typedUpload.user_id)
      .map((dish) => ({
        dish_name: dish.dish_name,
        dish_key: dish.dish_key,
        price: null as number | null,
      }));

    const mergedBase = (baseDishes.length > 0 ? baseDishes : fallbackFromVisitDishes).filter(
      (row, index, list) => list.findIndex((entry) => entry.dish_key === row.dish_key) === index,
    );

    const drafts: PersonalDishDraft[] = mergedBase.map((base) => {
      const existing = personalEntries.find((entry) => entry.dish_key === base.dish_key);
      return {
        dish_key: base.dish_key,
        dish_name: base.dish_name,
        price: existing?.price_original ?? base.price,
        identity_tag: existing?.identity_tag ?? null,
        comment: existing?.comment ?? '',
        had_it: existing?.had_it ?? true,
      };
    });

    setItems(typedItems.map((item) => ({ ...item, identity_tag: null })));
    setVisitDishes(typedVisitDishes);
    setPersonalDrafts(drafts);
    setRestaurant((restaurantData.data ?? null) as Pick<Restaurant, 'name' | 'address'> | null);
    setVisitNote(typedUpload.visit_note ?? '');

    await loadParticipants();
  }, [loadParticipants, uploadId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!isHost || shareEmail.trim().length < 2) {
      setShareSuggestions([]);
      setShareSuggestLoading(false);
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setShareSuggestLoading(true);
        const headers = await getAuthHeader();
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(shareEmail.trim())}`, { headers });

        if (!response.ok) {
          setShareSuggestions([]);
          return;
        }

        const payload = (await response.json()) as { users?: ShareUserSuggestion[] };
        setShareSuggestions(payload.users ?? []);
      } finally {
        setShareSuggestLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [getAuthHeader, isHost, shareEmail]);

  const runExtraction = useCallback(async () => {
    await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
    await load();
  }, [load, uploadId]);

  useEffect(() => {
    if (didAutoExtractRef.current) return;
    if (!isHost || !upload) return;
    if (upload.status !== 'uploaded') return;
    if (!upload.image_paths || upload.image_paths.length === 0) return;
    if (hasAnyExtractedItems || hasAnySavedVisitDishes) return;

    didAutoExtractRef.current = true;
    void runExtraction();
  }, [hasAnyExtractedItems, hasAnySavedVisitDishes, isHost, runExtraction, upload]);

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

  const saveExperience = async () => {
    if (!upload || !currentUserId || personalDrafts.length === 0) return;

    setSavingExperience(true);

    try {
      const supabase = getBrowserSupabaseClient();
      const rows = personalDrafts.map((dish) => ({
        user_id: currentUserId,
        restaurant_id: upload.restaurant_id,
        dish_name: dish.dish_name,
        price_original: dish.price,
        currency_original: upload.currency_detected || 'USD',
        price_usd: dish.price,
        eaten_at: upload.visited_at ?? upload.created_at,
        source_upload_id: upload.id,
        dish_key: dish.dish_key,
        identity_tag: dish.identity_tag,
        comment: dish.comment.trim() || null,
        had_it: dish.had_it,
      }));

      await supabase.from('dish_entries').upsert(rows, {
        onConflict: 'user_id,source_upload_id,dish_key',
      });

      await load();
      router.refresh();
    } finally {
      setSavingExperience(false);
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

  const addParticipant = async () => {
    const email = shareEmail.trim().toLowerCase();
    if (!email || !upload) return;

    setShareLoading(true);
    setShareError(null);

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      };

      const response = await fetch('/api/visits/share', {
        method: 'POST',
        headers,
        body: JSON.stringify({ visitId: upload.id, email }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ error: 'Could not share visit' }))) as { error?: string };
        throw new Error(payload.error ?? 'Could not share visit');
      }

      setShareEmail('');
      await loadParticipants();
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not share visit');
    } finally {
      setShareLoading(false);
    }
  };

  const removeParticipant = async (participantId: string) => {
    if (!upload) return;

    setShareLoading(true);
    setShareError(null);

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      };

      const response = await fetch('/api/visits/share', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ visitId: upload.id, participantId }),
      });

      if (!response.ok) {
        throw new Error('Could not remove participant');
      }

      await loadParticipants();
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not remove participant');
    } finally {
      setShareLoading(false);
    }
  };

  if (!upload) {
    return <div className="text-sm text-app-muted">Loading visit...</div>;
  }

  if (currentUserId && !canViewVisit) {
    return <div className="card-surface text-sm text-app-muted">You do not have access to this visit.</div>;
  }

  const visitDate = formatDate(upload.visited_at ?? upload.created_at);
  const isSharedVisit = Boolean(upload.is_shared);
  const isReviewable = upload.status === 'needs_review' && isHost;
  const showHostShareSection = isHost && isSharedVisit;
  const showStandaloneExperience = isSharedVisit && (!isHost || !isReviewable);

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

      {showHostShareSection && (
        <div className="card-surface space-y-3">
          <h2 className="section-label">Share this visit (optional)</h2>
          <div className="relative">
            <div className="flex gap-2">
              <Input
                value={shareEmail}
                onFocus={() => setShareFocused(true)}
                onBlur={() => window.setTimeout(() => setShareFocused(false), 120)}
                onChange={(event) => setShareEmail(event.target.value)}
                placeholder="Search by email or type full email"
                type="email"
              />
              <Button type="button" variant="secondary" fullWidth={false} onClick={addParticipant} disabled={shareLoading}>
                Add
              </Button>
            </div>
            {shareFocused && shareEmail.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-app-border bg-app-card shadow-sm">
                {shareSuggestLoading && <p className="p-3 text-xs text-app-muted">Searching users...</p>}
                {!shareSuggestLoading && shareSuggestions.length === 0 && (
                  <p className="p-3 text-xs text-app-muted">No user match. You can still invite this email.</p>
                )}
                {!shareSuggestLoading &&
                  shareSuggestions.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setShareEmail(user.email);
                        setShareSuggestions([]);
                        setShareFocused(false);
                      }}
                      className="w-full border-b border-app-border px-3 py-2 text-left last:border-b-0"
                    >
                      <p className="text-sm text-app-text">{user.email}</p>
                    </button>
                  ))}
              </div>
            )}
          </div>
          {shareError && <p className="text-xs text-rose-700 dark:text-rose-300">{shareError}</p>}
          <div className="space-y-2">
            {participants.length === 0 ? (
              <p className="text-xs text-app-muted">No participants yet.</p>
            ) : (
              participants.map((participant) => (
                <div key={participant.id} className="flex items-center justify-between gap-3 rounded-xl border border-app-border bg-app-card px-3 py-2">
                  <div>
                    <p className="text-sm text-app-text">{participant.invited_email ?? participant.user_id ?? 'Unknown participant'}</p>
                    <p className="text-xs text-app-muted">{participant.status === 'invited' ? 'Invite pending' : 'Active participant'}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    className="h-8 px-2 text-xs"
                    onClick={() => removeParticipant(participant.id)}
                    disabled={shareLoading}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showExtractionPrompt && (
        <div className="card-surface space-y-3">
          <h2 className="section-label">Extraction</h2>
          <p className="text-sm text-app-muted">{isSharedVisit ? 'Run extraction to generate dishes for review and shared experience.' : 'Run extraction to generate dishes for quick review.'}</p>
          <Button type="button" variant="secondary" onClick={runExtraction}>
            Run extraction
          </Button>
        </div>
      )}

      {isReviewable && (
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

          <h3 className="section-label">{isSharedVisit ? 'Dishes (review + your experience)' : 'Extracted dishes (host review)'}</h3>
          {isSharedVisit && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() =>
                  setPersonalDrafts((prev) =>
                    prev.map((dish) => ({
                      ...dish,
                      had_it: true,
                    })),
                  )
                }
              >
                Mark all as had it
              </Button>
            </div>
          )}
          {items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-app-border p-4 text-sm text-app-muted">
              No extracted dishes yet. You can still save the visit note, then approve.
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item, index) => {
                const noteOpen = openItemNotes[item.id] || Boolean(item.comment);
                const dishName = item.name_final || item.name_raw;
                const draftDishKey = toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
                const draftIndex = personalDrafts.findIndex((entry) => entry.dish_key === draftDishKey);
                const personalDraft = draftIndex >= 0 ? personalDrafts[draftIndex] : null;

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
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, included: !entry.included } : entry,
                            ),
                          )
                        }
                        className={`inline-flex h-11 items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors duration-200 ${
                          item.included
                            ? 'border-app-primary bg-app-primary text-app-primary-text'
                            : 'border-app-border bg-app-card text-app-muted'
                        }`}
                        aria-pressed={item.included}
                      >
                        {item.included ? 'Included' : 'Excluded'}
                      </button>
                    </div>

                    <IdentitySelector
                      value={item.identity_tag}
                      onChange={(value) => {
                        setItems((prev) =>
                          prev.map((entry, itemIndex) =>
                            itemIndex === index ? { ...entry, identity_tag: value } : entry,
                          ),
                        );

                        if (isSharedVisit && draftIndex >= 0) {
                          setPersonalDrafts((prev) =>
                            prev.map((entry, i) =>
                              i === draftIndex
                                ? {
                                    ...entry,
                                    identity_tag: value,
                                  }
                                : entry,
                            ),
                          );
                        }
                      }}
                    />

                    <div className="space-y-2">
                      {isSharedVisit ? (
                        <>
                          <div className="flex items-center justify-between rounded-xl border border-app-border px-3 py-2">
                            <p className="text-sm text-app-text">I had this dish</p>
                            <button
                              type="button"
                              onClick={() => {
                                if (draftIndex < 0) return;
                                setPersonalDrafts((prev) =>
                                  prev.map((entry, i) =>
                                    i === draftIndex
                                      ? {
                                          ...entry,
                                          had_it: !entry.had_it,
                                        }
                                      : entry,
                                  ),
                                );
                              }}
                              className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-200 ${
                                personalDraft?.had_it
                                  ? 'border-app-primary bg-app-primary text-app-primary-text'
                                  : 'border-app-border bg-app-card text-app-muted'
                              }`}
                            >
                              {personalDraft?.had_it ? 'Had it' : "Didn't have it"}
                            </button>
                          </div>
                          <Input
                            value={item.comment ?? ''}
                            maxLength={140}
                            onChange={(e) => {
                              const value = e.target.value;
                              setItems((prev) =>
                                prev.map((entry, itemIndex) =>
                                  itemIndex === index ? { ...entry, comment: value } : entry,
                                ),
                              );

                              if (draftIndex >= 0) {
                                setPersonalDrafts((prev) =>
                                  prev.map((entry, i) =>
                                    i === draftIndex
                                      ? {
                                          ...entry,
                                          comment: value,
                                        }
                                      : entry,
                                  ),
                                );
                              }
                            }}
                            placeholder="Optional dish note"
                          />
                        </>
                      ) : (
                        <>
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
                        </>
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
      )}

      {showStandaloneExperience && (
      <div className="card-surface space-y-3">
        <h2 className="section-label">Your experience</h2>
        {personalDrafts.length === 0 ? (
          <p className="empty-surface">No dishes available for personal annotation yet. Run extraction first.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() =>
                  setPersonalDrafts((prev) =>
                    prev.map((dish) => ({
                      ...dish,
                      had_it: true,
                    })),
                  )
                }
              >
                Mark all as had it
              </Button>
            </div>

            <div className="space-y-3">
              {personalDrafts.map((dish, index) => (
                <div key={dish.dish_key} className="rounded-2xl border border-app-border bg-app-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-app-text">{dish.dish_name}</p>
                      <p className="text-xs text-app-muted">{formatPrice(dish.price)}</p>
                    </div>
                    {dish.identity_tag && <IdentityTagPill tag={dish.identity_tag} />}
                  </div>

                  <IdentitySelector
                    value={dish.identity_tag}
                    onChange={(value) =>
                      setPersonalDrafts((prev) =>
                        prev.map((entry, i) =>
                          i === index
                            ? {
                                ...entry,
                                identity_tag: value,
                              }
                            : entry,
                        ),
                      )
                    }
                  />

                  <div className="flex items-center justify-between rounded-xl border border-app-border px-3 py-2">
                    <p className="text-sm text-app-text">I had this dish</p>
                    <button
                      type="button"
                      onClick={() =>
                        setPersonalDrafts((prev) =>
                          prev.map((entry, i) =>
                            i === index
                              ? {
                                  ...entry,
                                  had_it: !entry.had_it,
                                }
                              : entry,
                          ),
                        )
                      }
                      className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-200 ${
                        dish.had_it
                          ? 'border-app-primary bg-app-primary text-app-primary-text'
                          : 'border-app-border bg-app-card text-app-muted'
                      }`}
                    >
                      {dish.had_it ? 'Had it' : "Didn't have it"}
                    </button>
                  </div>

                  <Input
                    value={dish.comment}
                    onChange={(event) =>
                      setPersonalDrafts((prev) =>
                        prev.map((entry, i) =>
                          i === index
                            ? {
                                ...entry,
                                comment: event.target.value,
                              }
                            : entry,
                        ),
                      )
                    }
                    placeholder="Optional personal note"
                    maxLength={140}
                  />
                </div>
              ))}
            </div>

            <div className="sticky bottom-4">
              <Button type="button" onClick={saveExperience} disabled={savingExperience}>
                {savingExperience ? 'Saving...' : 'Save your experience'}
              </Button>
            </div>
          </>
        )}
      </div>
      )}

      {visitDishes.length > 0 && (
        <div className="card-surface space-y-3">
          <h2 className="section-label">Visit dishes (saved)</h2>
          {visitDishes.map((dish) => (
            <Link key={dish.id} href={`/dishes/${dish.dish_key}`} className="rounded-2xl border border-app-border bg-app-card p-4 block">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-medium text-app-text">{dish.dish_name}</p>
                <IdentityTagPill tag={dish.identity_tag} />
              </div>
              {dish.comment && <p className="text-xs text-app-muted">{dish.comment}</p>}
              <p className="text-xs text-app-muted">{formatDate(dish.eaten_at ?? dish.created_at)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

