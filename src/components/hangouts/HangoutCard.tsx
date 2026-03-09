'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Camera, Users, Utensils } from 'lucide-react';
import { HangoutCardItem } from '@/components/hangouts/types';

export function HangoutCard({ item }: { item: HangoutCardItem }) {
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

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/65 via-black/25 to-transparent" />
        <div className="absolute bottom-2 right-2 flex items-center gap-2 text-[11px] font-medium text-white">
          <span className="inline-flex items-center gap-1">
            <Users size={12} />
            {item.participantCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Utensils size={12} />
            {item.dishCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Camera size={12} />
            {item.photoCount}
          </span>
        </div>
      </div>

      <div className="p-3">
        <p className="truncate text-sm font-semibold text-app-text">
          {item.restaurantName} · {item.dateLabel} · {item.ownershipLabel}
        </p>
      </div>
    </Link>
  );
}
