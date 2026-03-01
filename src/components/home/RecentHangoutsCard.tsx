import Link from 'next/link';
import { HangoutChip } from '@/lib/home/getHangoutChips';

export function RecentHangoutsCard({ chips }: { chips: HangoutChip[] }) {
  return (
    <section className="card-surface p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="section-label">Recent hangouts</p>
          <p className="text-xs text-app-muted">Your go-to spots.</p>
        </div>
        <Link href="/hangouts" className="text-xs font-medium text-app-link">
          View all hangouts
        </Link>
      </div>

      {chips.length === 0 ? (
        <p className="text-sm text-app-muted">No hangout patterns yet. Add a hangout to start seeing chips.</p>
      ) : (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {chips.map((chip) => (
            <Link
              key={chip.restaurant_id}
              href={chip.href}
              className="inline-flex h-11 shrink-0 items-center rounded-lg border border-app-border bg-app-card px-3 text-xs font-semibold text-app-text"
            >
              {chip.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
