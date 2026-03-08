'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Calendar, ChevronDown, Search, Users, UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/utils';

export type HangoutFilterState = {
  search: string;
  crew: string;
  placeType: string;
  vibe: string;
  time: string;
  sort: 'newest' | 'oldest' | 'most_people';
};

type Option = {
  value: string;
  label: string;
};

const PLACE_TYPE_OPTIONS: Option[] = [
  { value: 'all', label: 'All' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'bar', label: 'Bar' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'home', label: 'Home' },
  { value: 'food_truck', label: 'Food Truck' },
];

const VIBE_OPTIONS: Option[] = [
  { value: 'all', label: 'All' },
  { value: 'hidden_gem', label: 'Hidden Gem' },
  { value: 'go_to', label: 'Go-To' },
  { value: 'celebration', label: 'Celebration' },
  { value: 'casual', label: 'Casual' },
  { value: 'fancy', label: 'Fancy' },
  { value: 'late_night', label: 'Late Night' },
];

const TIME_OPTIONS: Option[] = [
  { value: 'all', label: 'All' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'this_year', label: 'This Year' },
];

const SORT_OPTIONS: Array<{ value: HangoutFilterState['sort']; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_people', label: 'Most people' },
];

function Dropdown({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  options: Option[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value)?.label ?? 'All';

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-[132px]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 w-full items-center justify-between gap-1 rounded-lg border border-app-border bg-app-card px-2 text-xs font-medium text-app-text"
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          {icon}
          <span className="truncate">{label}: {selected}</span>
        </span>
        <ChevronDown size={13} className="shrink-0 text-app-muted" />
      </button>

      {open ? (
        <div className="absolute left-0 top-10 z-30 w-52 max-w-[86vw] rounded-xl border border-app-border bg-app-card p-1.5">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex h-8 w-full items-center rounded-lg px-2 text-left text-xs',
                option.value === value ? 'bg-app-primary text-app-primary-text' : 'text-app-text hover:bg-app-bg',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HangoutFilters({
  state,
  onChange,
  crewOptions,
  onClear,
}: {
  state: HangoutFilterState;
  onChange: (next: Partial<HangoutFilterState>) => void;
  crewOptions: Option[];
  onClear: () => void;
}) {
  const hasActiveFilters = useMemo(() => {
    return state.search || state.crew !== 'all' || state.placeType !== 'all' || state.vibe !== 'all' || state.time !== 'all';
  }, [state]);

  return (
    <section className="card-surface space-y-2 p-3">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-app-muted" />
        <input
          value={state.search}
          onChange={(event) => onChange({ search: event.target.value })}
          placeholder="Search place or crew"
          className="h-10 w-full rounded-lg border border-app-border bg-app-bg pl-8 pr-2.5 text-sm text-app-text"
        />
      </div>

      <div className="action-row-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <Dropdown
          label="Crew"
          icon={<Users size={13} className="text-app-muted" />}
          value={state.crew}
          options={crewOptions}
          onChange={(next) => onChange({ crew: next })}
        />
        <Dropdown
          label="Place"
          icon={<UtensilsCrossed size={13} className="text-app-muted" />}
          value={state.placeType}
          options={PLACE_TYPE_OPTIONS}
          onChange={(next) => onChange({ placeType: next })}
        />
        <Dropdown
          label="Vibe"
          icon={<span className="text-[11px] text-app-muted">V</span>}
          value={state.vibe}
          options={VIBE_OPTIONS}
          onChange={(next) => onChange({ vibe: next })}
        />
        <Dropdown
          label="Time"
          icon={<Calendar size={13} className="text-app-muted" />}
          value={state.time}
          options={TIME_OPTIONS}
          onChange={(next) => onChange({ time: next })}
        />
        <Dropdown
          label="Sort"
          icon={<span className="text-[11px] text-app-muted">S</span>}
          value={state.sort}
          options={SORT_OPTIONS}
          onChange={(next) => onChange({ sort: next as HangoutFilterState['sort'] })}
        />
      </div>

      {hasActiveFilters ? (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 items-center rounded-lg border border-app-border px-2 text-xs font-medium text-app-muted"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </section>
  );
}

