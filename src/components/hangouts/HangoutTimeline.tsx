'use client';

import Link from 'next/link';
import { Camera, MapPin, Utensils } from 'lucide-react';
import { HangoutCardItem } from '@/components/hangouts/types';
import { hangoutVibeLabel } from '@/lib/hangouts/vibes';

function monthLabel(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function HangoutTimeline({ items }: { items: HangoutCardItem[] }) {
  if (items.length === 0) {
    return <p className="empty-surface">No hangouts match these filters.</p>;
  }

  let previousMonth = '';

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const currentMonth = monthLabel(item.timestamp);
        const showMonth = currentMonth !== previousMonth;
        previousMonth = currentMonth;
        const visibleVibes = item.vibeKeys.map(hangoutVibeLabel);

        return (
          <div key={item.id} className="space-y-1">
            {showMonth ? <p className="px-0.5 text-xs font-semibold uppercase tracking-wide text-app-muted">{currentMonth}</p> : null}

            <Link href={item.href} className="block rounded-xl border border-app-border bg-app-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-semibold text-app-text">{item.restaurantName}</p>
                  {item.address ? (
                    <p className="line-clamp-1 inline-flex items-center gap-1 text-xs text-app-muted">
                      <MapPin size={12} />
                      {item.address}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {visibleVibes.map((badge) => (
                      <span key={badge} className="inline-flex h-6 items-center rounded-full border border-app-border bg-app-bg px-2 text-[11px] text-app-muted">
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="shrink-0 text-xs text-app-muted">{item.dateLabel} · {item.ownershipLabel}</p>
              </div>

              <div className="mt-2 flex items-center gap-3 text-[11px] text-app-muted">
                <span className="inline-flex items-center gap-1">
                  <Camera size={12} />
                  {item.photoCount}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Utensils size={12} />
                  {item.dishCount}
                </span>
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
