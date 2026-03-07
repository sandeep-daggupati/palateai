'use client';

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Ban, Camera, Check, Ellipsis, FileText, Gem, Pencil, RotateCcw, Sparkles, Star, Wine, X } from 'lucide-react';
import { DishIdentityTag } from '@/lib/supabase/types';

type DishActionBarProps = {
  onAddPhoto?: () => void;
  showPhotoAction?: boolean;
  onEdit: () => void;
  onSetRating: (value: DishIdentityTag | null) => void;
  ratingValue: DishIdentityTag | null;
  noteValue: string;
  onSaveNote: (value: string) => void;
};

const ICON_STROKE = 1.5;

const IDENTITY_ICON: Record<DishIdentityTag, typeof Star> = {
  go_to: Star,
  hidden_gem: Gem,
  special_occasion: Wine,
  try_again: RotateCcw,
  never_again: Ban,
};

const IDENTITY_ORDER: DishIdentityTag[] = ['go_to', 'hidden_gem', 'special_occasion', 'try_again', 'never_again'];

export function DishActionBar({
  onAddPhoto,
  showPhotoAction = true,
  onEdit,
  onSetRating,
  ratingValue,
  noteValue,
  onSaveNote,
}: DishActionBarProps) {
  const [ratingOpen, setRatingOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(noteValue ?? '');
  const [isMobile, setIsMobile] = useState(false);

  const ratingRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraftNote(noteValue ?? '');
  }, [noteValue]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!isMobile || (!ratingOpen && !noteOpen)) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isMobile, noteOpen, ratingOpen]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ratingRef.current && !ratingRef.current.contains(target)) {
        setRatingOpen(false);
      }
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (noteRef.current && !noteRef.current.contains(target)) {
        setNoteOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRatingOpen(false);
        setMenuOpen(false);
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

  const SelectedRatingIcon = ratingValue ? IDENTITY_ICON[ratingValue] : null;
  const stopTap = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="relative max-w-full">
      <div className="action-row-scroll flex min-h-11 max-w-full items-center gap-1.5 overflow-x-auto px-1 py-0.5">
        {showPhotoAction ? (
          <button
            type="button"
            aria-label="Add food photo"
            onClick={(event) => {
              stopTap(event);
              onAddPhoto?.();
            }}
            className="icon-button-subtle shrink-0"
          >
            <Camera size={16} strokeWidth={ICON_STROKE} />
          </button>
        ) : null}

        <div ref={ratingRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Set rating"
            aria-expanded={ratingOpen}
            onClick={(event) => {
              stopTap(event);
              setRatingOpen((prev) => !prev);
              setMenuOpen(false);
              setNoteOpen(false);
            }}
            className={`icon-button-subtle relative ${SelectedRatingIcon ? 'border-app-primary bg-app-primary/15 shadow-[0_0_0_2px_rgba(31,61,43,0.15)]' : ''}`}
          >
            {SelectedRatingIcon ? <SelectedRatingIcon size={16} strokeWidth={ICON_STROKE} /> : <Sparkles size={16} strokeWidth={ICON_STROKE} />}
            {SelectedRatingIcon ? <span className="absolute -right-1 -top-1 rounded-full bg-app-primary p-0.5 text-app-primary-text"><Check size={9} strokeWidth={2.5} /></span> : null}
          </button>

          {ratingOpen && !isMobile ? (
            <div className="absolute left-0 top-9 z-30 rounded-xl border border-app-border bg-app-card p-1.5 shadow-lg">
              <div className="flex items-center gap-1">
                {IDENTITY_ORDER.map((tag) => {
                  const active = tag === ratingValue;
                  const TagIcon = IDENTITY_ICON[tag];
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-label={`Set rating ${tag.replace('_', ' ')}`}
                      onClick={(event) => {
                        stopTap(event);
                        onSetRating(active ? null : tag);
                        setRatingOpen(false);
                      }}
                      className={`icon-button-subtle relative ${active ? 'border-app-primary bg-app-primary/15 shadow-[0_0_0_2px_rgba(31,61,43,0.15)]' : ''}`}
                    >
                      <TagIcon size={16} strokeWidth={ICON_STROKE} />
                      {active ? <span className="absolute -right-1 -top-1 rounded-full bg-app-primary p-0.5 text-app-primary-text"><Check size={9} strokeWidth={2.5} /></span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="More actions"
            aria-expanded={menuOpen}
            onClick={(event) => {
              stopTap(event);
              setMenuOpen((prev) => !prev);
              setRatingOpen(false);
              setNoteOpen(false);
            }}
            className="icon-button-subtle relative"
          >
            <Ellipsis size={16} strokeWidth={ICON_STROKE} />
            {noteValue.trim().length > 0 ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-app-primary" /> : null}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-30 w-44 max-w-[calc(100vw-1.5rem)] rounded-xl border border-app-border bg-app-card p-1.5 shadow-lg">
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-app-text hover:bg-app-bg/70"
                onClick={(event) => {
                  stopTap(event);
                  setMenuOpen(false);
                  onEdit();
                }}
              >
                <Pencil size={14} strokeWidth={ICON_STROKE} />
                Edit details
              </button>
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-app-text hover:bg-app-bg/70"
                onClick={(event) => {
                  stopTap(event);
                  setMenuOpen(false);
                  setNoteOpen(true);
                }}
              >
                <FileText size={14} strokeWidth={ICON_STROKE} />
                {noteValue.trim().length > 0 ? 'Edit note' : 'Add note'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div ref={noteRef} className="relative">
        {noteOpen && !isMobile ? (
          <div className="absolute left-0 top-9 z-30 w-64 max-w-[80vw] rounded-xl border border-app-border bg-app-card p-2 shadow-lg">
            <textarea
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
                onClick={(event) => {
                  stopTap(event);
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
                onClick={(event) => {
                  stopTap(event);
                  onSaveNote(draftNote);
                  setNoteOpen(false);
                }}
                className="h-8 rounded-lg bg-app-primary px-3 text-xs font-medium text-app-primary-text"
              >
                Save
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {ratingOpen && isMobile ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close vibe picker"
            onClick={(event) => {
              stopTap(event);
              setRatingOpen(false);
            }}
          />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-app-text">Set vibe</p>
              <button type="button" className="icon-button-subtle" onClick={(event) => { stopTap(event); setRatingOpen(false); }}>
                <X size={14} strokeWidth={1.7} />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              {IDENTITY_ORDER.map((tag) => {
                const active = tag === ratingValue;
                const TagIcon = IDENTITY_ICON[tag];
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-label={`Set rating ${tag.replace('_', ' ')}`}
                    onClick={(event) => {
                      stopTap(event);
                      onSetRating(active ? null : tag);
                      setRatingOpen(false);
                    }}
                    className={`icon-button-subtle relative h-10 w-10 ${active ? 'border-app-primary bg-app-primary/15 shadow-[0_0_0_2px_rgba(31,61,43,0.15)]' : ''}`}
                  >
                    <TagIcon size={17} strokeWidth={ICON_STROKE} />
                    {active ? <span className="absolute -right-1 -top-1 rounded-full bg-app-primary p-0.5 text-app-primary-text"><Check size={9} strokeWidth={2.5} /></span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {noteOpen && isMobile ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close note editor"
            onClick={(event) => {
              stopTap(event);
              setNoteOpen(false);
            }}
          />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-app-text">{noteValue.trim().length > 0 ? 'Edit note' : 'Add note'}</p>
              <button type="button" className="icon-button-subtle" onClick={(event) => { stopTap(event); setNoteOpen(false); }}>
                <X size={14} strokeWidth={1.7} />
              </button>
            </div>
            <textarea
              value={draftNote}
              rows={4}
              maxLength={140}
              onChange={(event) => setDraftNote(event.target.value)}
              placeholder="Add note..."
              className="w-full rounded-lg border border-app-border bg-app-bg px-2 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary/35"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={(event) => {
                  stopTap(event);
                  setDraftNote('');
                  onSaveNote('');
                  setNoteOpen(false);
                }}
                className="h-9 rounded-lg border border-app-border px-3 text-xs text-app-muted"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={(event) => {
                  stopTap(event);
                  onSaveNote(draftNote);
                  setNoteOpen(false);
                }}
                className="h-9 rounded-lg bg-app-primary px-3 text-xs font-medium text-app-primary-text"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
