'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Coffee, Filter, Gem, Martini, Moon, Search, Sparkles, Star, Users, UtensilsCrossed, X } from 'lucide-react';
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

const VIBE_OPTIONS: Option[] = [
  { value: 'all', label: 'All' },
  { value: 'hidden_gem', label: 'Hidden Gem' },
  { value: 'go_to', label: 'Go-To' },
  { value: 'celebration', label: 'Celebration' },
  { value: 'casual', label: 'Casual' },
  { value: 'fancy', label: 'Fancy' },
  { value: 'late_night', label: 'Late Night' },
];

function getSelectedLabel(options: Option[], value: string): string | null {
  if (value === 'all') return null;
  return options.find((option) => option.value === value)?.label ?? null;
}

function vibeIcon(value: string): ReactNode {
  switch (value) {
    case 'hidden_gem':
      return <Gem size={13} strokeWidth={1.5} />;
    case 'go_to':
      return <Star size={13} strokeWidth={1.5} />;
    case 'celebration':
      return <Sparkles size={13} strokeWidth={1.5} />;
    case 'casual':
      return <Coffee size={13} strokeWidth={1.5} />;
    case 'fancy':
      return <Martini size={13} strokeWidth={1.5} />;
    case 'late_night':
      return <Moon size={13} strokeWidth={1.5} />;
    default:
      return <Sparkles size={13} strokeWidth={1.5} />;
  }
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return isMobile;
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
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeSheetFilter, setActiveSheetFilter] = useState<FilterKey>('crew');

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

  const activeConfig = configs.find((config) => config.key === activeSheetFilter) ?? configs[0];

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

      {isMobile ? (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-app-border bg-app-card px-3 text-xs font-medium text-app-text"
          >
            <Filter size={12} />
            Filters
            {hasActiveFilters ? <span className="text-app-primary">•</span> : null}
          </button>

          {hasActiveFilters ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-8 items-center rounded-full border border-app-border px-3 text-xs font-medium text-app-muted"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : (
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
      )}

      {sheetOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:hidden">
          <button type="button" className="absolute inset-0" aria-label="Close filters" onClick={() => setSheetOpen(false)} />
          <div className="relative w-full max-w-2xl rounded-t-2xl border border-app-border bg-app-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-app-text">Filters</p>
              <button type="button" onClick={() => setSheetOpen(false)} className="icon-button-subtle" aria-label="Close">
                <X size={14} />
              </button>
            </div>

            <div className="action-row-scroll -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {configs.map((config) => {
                const selectedLabel = getSelectedLabel(config.options, config.value);
                const active = activeSheetFilter === config.key;
                return (
                  <button
                    key={config.key}
                    type="button"
                    onClick={() => setActiveSheetFilter(config.key)}
                    className={cn(
                      'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium',
                      active ? 'border-app-primary bg-app-primary text-app-primary-text' : 'border-app-border text-app-text',
                    )}
                  >
                    {config.icon}
                    {selectedLabel ? `${config.label}: ${selectedLabel}` : config.label}
                  </button>
                );
              })}
            </div>

            <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-app-border p-1.5">
              {activeConfig.options.map((option) => {
                const selected = option.value === activeConfig.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      activeConfig.onChange(option.value);
                    }}
                    className={cn(
                      'flex h-9 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm',
                      selected ? 'bg-app-primary text-app-primary-text' : 'text-app-text hover:bg-app-bg',
                    )}
                  >
                    {activeConfig.key === 'vibe' && option.value !== 'all' ? vibeIcon(option.value) : null}
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onClear}
                className="inline-flex h-9 items-center rounded-lg border border-app-border px-3 text-xs font-medium text-app-muted"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="inline-flex h-9 items-center rounded-lg bg-app-primary px-3 text-xs font-medium text-app-primary-text"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
