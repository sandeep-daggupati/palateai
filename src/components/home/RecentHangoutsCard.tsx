import Image from 'next/image';
import Link from 'next/link';
import { Star, Users, UtensilsCrossed } from 'lucide-react';
import { RecentHangoutRow } from '@/lib/home/getHomeOverview';

function AvatarStack({
  avatars,
}: {
  avatars: RecentHangoutRow['avatars'];
}) {
  return (
    <div className="flex items-center">
      {avatars.slice(0, 4).map((avatar, index) => (
        <span
          key={`${avatar.user_id}-${index}`}
          className="-ml-1 first:ml-0 inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-app-card bg-app-bg text-[10px] font-semibold text-app-text"
          title={avatar.name}
        >
          {avatar.avatar_url ? (
            <Image src={avatar.avatar_url} alt={avatar.name} width={24} height={24} className="h-full w-full object-cover" unoptimized />
          ) : (
            avatar.name.charAt(0).toUpperCase()
          )}
        </span>
      ))}
    </div>
  );
}

export function RecentHangoutsCard({ items }: { items: RecentHangoutRow[] }) {
  return (
    <section className="card-surface p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="section-label">Recent Hangouts</p>
          <p className="text-xs text-app-muted">Your latest shared food memories.</p>
        </div>
        <Link href="/hangouts" className="text-xs font-medium text-app-link">
          View all hangouts
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-app-muted">No hangouts yet. Start one from Add.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link key={item.id} href={`/uploads/${item.id}`} className="block rounded-xl border border-app-border bg-app-card p-2.5">
              <p className="text-sm font-semibold text-app-text">{item.restaurant_name}</p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-app-muted">
                <span>{item.date_label}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1"><Users size={12} /> {item.people_count} people</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1"><UtensilsCrossed size={12} /> {item.dish_count} dishes</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <AvatarStack avatars={item.avatars} />
                <span className="inline-flex items-center gap-1 text-xs text-app-muted">
                  <Star size={12} className="text-app-accent" />
                  {item.average_rating ? item.average_rating.toFixed(1) : '—'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
