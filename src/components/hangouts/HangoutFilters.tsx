'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Briefcase, ChevronDown, Coffee, Gem, Moon, Search, Sparkles, Star, Users, UtensilsCrossed } from 'lucide-react';
import { HANGOUT_VIBE_OPTIONS, HangoutVibeKey } from '@/lib/hangouts/vibes';
import { cn } from '@/lib/utils';

export type HangoutFilterState = {
  search: string;
  crew: string;
  placeType: string;
  vibe: string;
};

type Option = {
  value: string;
  label: string;
};

type FilterKey = 'crew' | 'place' | 'vibe';

type FilterConfig = {
  key: FilterKey;
  label: string;
  icon: ReactNode;
  options: Option[];
  value: string;
  onChange: (next: string) => void;
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

const VIBE_OPTIONS: Option[] = [{ value: 'all', label: 'All' }, ...HANGOUT_VIBE_OPTIONS.map((entry) => ({ value: entry.key, label: entry.label }))];

function getSelectedLabel(options: Option[], value: string): string | null {
  if (value === 'all') return null;
  return options.find((option) => option.value === value)?.label ?? null;
}

function vibeIcon(value: string): ReactNode {
  switch (value as HangoutVibeKey) {
    case 'quick_bite':
      return <Coffee size={13} strokeWidth={1.5} />;
    case 'go_to_spot':
      return <Star size={13} strokeWidth={1.5} />;
    case 'celebration':
      return <Sparkles size={13} strokeWidth={1.5} />;
    case 'work_hangout':
      return <Briefcase size={13} strokeWidth={1.5} />;
    case 'mixer':
      return <Users size={13} strokeWidth={1.5} />;
    case 'with_friends':
      return <Users size={13} strokeWidth={1.5} />;
    case 'night_out':
      return <Moon size={13} strokeWidth={1.5} />;
    case 'hidden_gem':
      return <Gem size={13} strokeWidth={1.5} />;
    default:
      return <Sparkles size={13} strokeWidth={1.5} />;
  }
}

function FilterChipPopover({ config }: { config: FilterConfig }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = getSelectedLabel(config.options, config.value);

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
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-8 items-center gap-1 rounded-full border border-app-border bg-app-card px-3 text-xs font-medium text-app-text"
      >
        <span className="inline-flex items-center gap-1">
          {config.icon}
          {selectedLabel ? `${config.label}: ${selectedLabel}` : config.label}
        </span>
        <ChevronDown size={12} className="text-app-muted" />
      </button>

      {open ? (
        <div className="absolute left-0 top-9 z-30 w-56 max-w-[85vw] rounded-xl border border-app-border bg-app-card p-1.5 shadow-sm">
          {config.options.map((option) => {
            const selected = option.value === config.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  config.onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-xs',
                  selected ? 'bg-app-primary text-app-primary-text' : 'text-app-text hover:bg-app-bg',
                )}
              >
                {config.key === 'vibe' && option.value !== 'all' ? vibeIcon(option.value) : null}
                {option.label}
              </button>
            );
          })}
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
    return state.search || state.crew !== 'all' || state.placeType !== 'all' || state.vibe !== 'all';
  }, [state]);

  const configs = useMemo<FilterConfig[]>(() => {
    return [
      {
        key: 'crew',
        label: 'Crew',
        icon: <Users size={12} className="text-app-muted" />,
        options: crewOptions,
        value: state.crew,
        onChange: (next) => onChange({ crew: next }),
      },
      {
        key: 'place',
        label: 'Place',
        icon: <UtensilsCrossed size={12} className="text-app-muted" />,
        options: PLACE_TYPE_OPTIONS,
        value: state.placeType,
        onChange: (next) => onChange({ placeType: next }),
      },
      {
        key: 'vibe',
        label: 'Vibe',
        icon: vibeIcon(state.vibe === 'all' ? 'celebration' : state.vibe),
        options: VIBE_OPTIONS,
        value: state.vibe,
        onChange: (next) => onChange({ vibe: next }),
      },
    ];
  }, [crewOptions, onChange, state.crew, state.placeType, state.vibe]);

  return (
    <section className="card-surface space-y-2 p-3">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
        <input
          value={state.search}
          onChange={(event) => onChange({ search: event.target.value })}
          placeholder="Search places, people, or dishes"
          className="h-11 w-full rounded-xl border border-app-border bg-app-bg pl-9 pr-3 text-sm text-app-text"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {configs.map((config) => (
          <FilterChipPopover key={config.key} config={config} />
        ))}
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-app-border px-3 text-xs font-medium text-app-muted"
          >
            Clear all
          </button>
        ) : null}
      </div>
    </section>
  );
}
