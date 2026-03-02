'use client';

import { useEffect, useRef, useState } from 'react';
import { DishIdentityTag } from '@/lib/supabase/types';

type DishActionBarProps = {
  onAddPhoto: () => void;
  onEdit: () => void;
  onSetRating: (value: DishIdentityTag | null) => void;
  ratingValue: DishIdentityTag | null;
  noteValue: string;
  onSaveNote: (value: string) => void;
};

const IDENTITY_EMOJI: Record<DishIdentityTag, string> = {
  go_to: '⭐',
  hidden_gem: '💎',
  special_occasion: '🥂',
  try_again: '🔁',
  never_again: '🚫',
};

const IDENTITY_ORDER: DishIdentityTag[] = ['go_to', 'hidden_gem', 'special_occasion', 'try_again', 'never_again'];

export function DishActionBar({
  onAddPhoto,
  onEdit,
  onSetRating,
  ratingValue,
  noteValue,
  onSaveNote,
}: DishActionBarProps) {
  const [ratingOpen, setRatingOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(noteValue ?? '');

  const ratingRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLDivElement | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraftNote(noteValue ?? '');
  }, [noteValue]);

  useEffect(() => {
    if (noteOpen) {
      window.setTimeout(() => noteInputRef.current?.focus(), 0);
    }
  }, [noteOpen]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ratingRef.current && !ratingRef.current.contains(target)) {
        setRatingOpen(false);
      }
      if (noteRef.current && !noteRef.current.contains(target)) {
        setNoteOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRatingOpen(false);
        setNoteOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="relative flex min-h-11 items-center gap-1.5">
      <button
        type="button"
        aria-label="Add food photo"
        onClick={onAddPhoto}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-app-border text-sm text-app-text"
      >
        📷
      </button>

      <button
        type="button"
        aria-label="Edit dish details"
        onClick={onEdit}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-app-border text-sm text-app-text"
      >
        ✏️
      </button>

      <div ref={ratingRef} className="relative">
        <button
          type="button"
          aria-label="Set rating"
          aria-expanded={ratingOpen}
          onClick={() => {
            setRatingOpen((prev) => !prev);
            setNoteOpen(false);
          }}
          className="inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full border border-app-border px-1.5 text-sm text-app-text"
        >
          <span aria-hidden>✨</span>
          {ratingValue ? <span className="text-[11px] leading-none">{IDENTITY_EMOJI[ratingValue]}</span> : null}
        </button>

        {ratingOpen && (
          <div className="absolute left-0 top-9 z-30 rounded-xl border border-app-border bg-app-card p-1.5 shadow-sm">
            <div className="flex items-center gap-1">
              {IDENTITY_ORDER.map((tag) => {
                const active = tag === ratingValue;
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-label={`Set rating ${tag.replace('_', ' ')}`}
                    onClick={() => {
                      onSetRating(active ? null : tag);
                      setRatingOpen(false);
                    }}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-base transition-all ${
                      active ? 'bg-app-primary/15' : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    {IDENTITY_EMOJI[tag]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div ref={noteRef} className="relative">
        <button
          type="button"
          aria-label="Open note editor"
          aria-expanded={noteOpen}
          onClick={() => {
            setNoteOpen((prev) => !prev);
            setRatingOpen(false);
          }}
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-app-border px-1.5 text-sm text-app-text"
        >
          <span aria-hidden>📝</span>
          {noteValue.trim().length > 0 ? <span className="ml-1 h-1.5 w-1.5 rounded-full bg-app-primary" /> : null}
        </button>

        {noteOpen && (
          <div className="absolute left-0 top-9 z-30 w-64 max-w-[80vw] rounded-xl border border-app-border bg-app-card p-2 shadow-sm">
            <textarea
              ref={noteInputRef}
              value={draftNote}
              rows={3}
              maxLength={140}
              onChange={(event) => setDraftNote(event.target.value)}
              placeholder="Add note..."
              className="w-full rounded-lg border border-app-border bg-app-bg px-2 py-1.5 text-xs text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary/35"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftNote('');
                  onSaveNote('');
                  setNoteOpen(false);
                }}
                className="h-8 rounded-lg border border-app-border px-2 text-xs text-app-muted"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  onSaveNote(draftNote);
                  setNoteOpen(false);
                }}
                className="h-8 rounded-lg bg-app-primary px-3 text-xs font-medium text-app-primary-text"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


