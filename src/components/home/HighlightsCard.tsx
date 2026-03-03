import Link from 'next/link';
import { HighlightCard } from '@/lib/home/getHighlights';

function HighlightCardItem({ card }: { card: HighlightCard }) {
  const content = (
    <>
      <div className="mb-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-app-primary/10 text-xs font-semibold text-app-text">
        {card.image_label}
      </div>
      <p className="text-xs uppercase tracking-wide text-app-muted">{card.title}</p>
      <p className="mt-0.5 text-sm font-semibold leading-5 text-app-text">{card.body}</p>
      <p className="mt-0.5 text-xs leading-4 text-app-muted">{card.hint}</p>
    </>
  );

  if (card.href) {
    return (
      <Link href={card.href} className="min-w-[190px] max-w-[190px] rounded-xl border border-app-border bg-app-card p-2">
        {content}
      </Link>
    );
  }

  return <div className="min-w-[190px] max-w-[190px] rounded-xl border border-app-border bg-app-card p-2">{content}</div>;
}

export function HighlightsCard({ highlights }: { highlights: HighlightCard[] }) {
  return (
    <section className="card-surface p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="section-label">Your highlights</p>
          <p className="text-xs text-app-muted">What your palate is into lately.</p>
        </div>
        <Link href="/food" className="text-xs font-medium text-app-link">
          View food
        </Link>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {highlights.slice(0, 3).map((card) => (
          <HighlightCardItem key={card.key} card={card} />
        ))}
      </div>
    </section>
  );
}
