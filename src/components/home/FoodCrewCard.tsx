import Image from 'next/image';
import { Star, Users } from 'lucide-react';
import { FoodCrewRow } from '@/lib/home/getHomeOverview';

export function FoodCrewCard({ rows }: { rows: FoodCrewRow[] }) {
  return (
    <section className="card-surface p-3 space-y-1.5">
      <div className="inline-flex items-center gap-2">
        <Users size={14} className="text-app-muted" />
        <p className="section-label">Food Crew</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-app-muted">Invite friends to a hangout and your crew activity will show up here.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <article key={row.user_id} className="rounded-xl border border-app-border bg-app-card p-2.5">
              <div className="flex items-start gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-app-border bg-app-bg text-xs font-semibold text-app-text">
                  {row.avatar_url ? (
                    <Image src={row.avatar_url} alt={row.name} width={32} height={32} className="h-full w-full object-cover" unoptimized />
                  ) : (
                    row.name.charAt(0).toUpperCase()
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-app-text">{row.name}</p>
                    <span className="text-xs text-app-muted">{row.hangout_count} hangouts</span>
                  </div>
                  <p className="mt-0.5 text-xs text-app-muted">
                    {row.introduced_spots > 0 ? `Introduced you to ${row.introduced_spots} spots` : 'Shared food memories with you'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-app-muted">
                  <Star size={12} className="text-app-accent" />
                  {row.average_rating ? row.average_rating.toFixed(1) : '—'}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
