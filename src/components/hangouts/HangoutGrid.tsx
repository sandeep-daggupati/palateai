'use client';

import { HangoutCard } from '@/components/hangouts/HangoutCard';
import { HangoutCardItem } from '@/components/hangouts/types';

export function HangoutGrid({ items }: { items: HangoutCardItem[] }) {
  if (items.length === 0) {
    return <p className="empty-surface">No hangouts match these filters.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <HangoutCard key={item.id} item={item} />
      ))}
    </div>
  );
}
