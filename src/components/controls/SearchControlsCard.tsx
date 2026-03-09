'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, LayoutGrid, Rows3, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ControlsViewMode = 'grid' | 'timeline';

export type SearchControlFilterOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

export type SearchControlFilterConfig = {
  key: string;
  label: string;
  icon: ReactNode;
  options: SearchControlFilterOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
};

function selectedSummary(config: SearchControlFilterConfig): string {
  if (config.selectedValues.length === 0) return config.label;

  const labels = config.options
    .filter((option) => config.selectedValues.includes(option.value))
    .map((option) => option.label);

  if (labels.length <= 2) return `${config.label}: ${labels.join(', ')}`;
  return `${config.label}: ${labels.length} selected`;
}

function MultiSelectChip({ config }: { config: SearchControlFilterConfig }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
    <div ref={rootRef} className="relative min-w-[108px] shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-8 w-full items-center justify-between gap-1 rounded-full border border-app-border bg-app-card px-3 text-xs font-medium text-app-text"
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          {config.icon}
          <span className="truncate">{selectedSummary(config)}</span>
        </span>
        <ChevronDown size={13} className="shrink-0 text-app-muted" />
      </button>

      {open ? (
        <div className="absolute left-0 top-9 z-30 w-56 max-w-[85vw] rounded-xl border border-app-border bg-app-card p-1.5 shadow-sm">
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {config.options.map((option) => {
              const selected = config.selectedValues.includes(option.value);

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => config.onToggle(option.value)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs',
                    selected ? 'bg-app-primary/10 text-app-text' : 'text-app-text hover:bg-app-bg',
                  )}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-app-border bg-app-card">
                    {selected ? <Check size={11} strokeWidth={2} className="text-app-primary" /> : null}
                  </span>
                  {option.icon ? <span className="inline-flex items-center text-app-muted">{option.icon}</span> : null}
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SearchControlsCard({
  view,
  onViewChange,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filters,
  hasActiveFilters,
  onClearAll,
}: {
  view: ControlsViewMode;
  onViewChange: (next: ControlsViewMode) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder: string;
  filters: SearchControlFilterConfig[];
  hasActiveFilters: boolean;
  onClearAll: () => void;
}) {
  return (
    <section className="card-surface space-y-2 p-3">
      <div className="inline-flex h-9 items-center rounded-xl border border-app-border bg-app-card p-1">
        <button
          type="button"
          onClick={() => onViewChange('grid')}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium',
            view === 'grid' ? 'bg-app-primary text-app-primary-text' : 'text-app-muted',
          )}
        >
          <LayoutGrid size={13} />
          Grid
        </button>
        <button
          type="button"
          onClick={() => onViewChange('timeline')}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium',
            view === 'timeline' ? 'bg-app-primary text-app-primary-text' : 'text-app-muted',
          )}
        >
          <Rows3 size={13} />
          Timeline
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
        <input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-11 w-full rounded-xl border border-app-border bg-app-bg pl-9 pr-3 text-sm text-app-text"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((filter) => (
          <MultiSelectChip key={filter.key} config={filter} />
        ))}

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-app-border px-3 text-xs font-medium text-app-muted"
          >
            Clear all
          </button>
        ) : null}
      </div>
    </section>
  );
}
