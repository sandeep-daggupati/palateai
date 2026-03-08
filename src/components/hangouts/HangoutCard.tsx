'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Camera, MapPin, Users, Utensils } from 'lucide-react';
import { HangoutCardItem } from '@/components/hangouts/types';
import { hangoutVibeLabel } from '@/lib/hangouts/vibes';

export function HangoutCard({ item }: { item: HangoutCardItem }) {
  const shownCrew = item.crew.slice(0, 3);
  const extraCrew = item.crew.length - shownCrew.length;
  const visibleVibes = item.vibeKeys.map(hangoutVibeLabel);

  return (
    <Link
      href={item.href}
      className="group overflow-hidden rounded-2xl border border-app-border bg-app-card transition-colors hover:border-app-primary/40"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-emerald-100 to-lime-100 dark:from-emerald-900/40 dark:to-lime-900/20">
        {item.coverPhotoUrl ? (
          <Image src={item.coverPhotoUrl} alt={`${item.restaurantName} hangout`} fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-medium text-emerald-800 dark:text-emerald-200">
            Add a hangout photo
          </div>
        )}
      </div>

      <div className="space-y-2 p-3">
        <div>
          <p className="truncate text-sm font-semibold text-app-text">{item.restaurantName}</p>
          {item.address ? (
            <p className="line-clamp-1 inline-flex items-center gap-1 text-xs text-app-muted">
              <MapPin size={12} />
              {item.address}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {visibleVibes.map((badge) => (
            <span key={badge} className="inline-flex h-6 items-center rounded-full border border-app-border bg-app-bg px-2 text-[11px] font-medium text-app-muted">
              {badge}
            </span>
          ))}
          <span className="inline-flex h-6 items-center rounded-full border border-app-border bg-app-bg px-2 text-[11px] text-app-muted">
            {item.dateLabel}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-1">
            <Users size={12} className="text-app-muted" />
            <div className="flex items-center gap-1">
              {shownCrew.map((member) => (
                <span key={member.id} className="inline-flex h-5 items-center rounded-full border border-app-border bg-app-bg px-1.5 text-[10px] text-app-muted">
                  {member.displayName}
                </span>
              ))}
              {extraCrew > 0 ? <span className="text-[10px] text-app-muted">+{extraCrew}</span> : null}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-app-muted">
            <span className="inline-flex items-center gap-1">
              <Camera size={12} />
              {item.photoCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <Utensils size={12} />
              {item.dishCount}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

