'use client';

import { LayoutGrid, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type HangoutViewMode = 'grid' | 'timeline';

export function HangoutViewToggle({
  view,
  onChange,
}: {
  view: HangoutViewMode;
  onChange: (next: HangoutViewMode) => void;
}) {
  return (
    <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-app-border bg-app-card p-1">
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium',
          view === 'grid' ? 'bg-app-primary text-app-primary-text' : 'text-app-muted hover:text-app-text',
        )}
      >
        <LayoutGrid size={13} />
        Grid
      </button>
      <button
        type="button"
        onClick={() => onChange('timeline')}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium',
          view === 'timeline' ? 'bg-app-primary text-app-primary-text' : 'text-app-muted hover:text-app-text',
        )}
      >
        <Rows3 size={13} />
        Timeline
      </button>
    </div>
  );
}
