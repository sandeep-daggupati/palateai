import { cn } from '@/lib/utils';

type RatingSize = 'sm' | 'md';

const STAR_SIZE_CLASS: Record<RatingSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
};

export function RatingStars({
  value,
  size = 'sm',
  showEmpty = false,
}: {
  value?: number | null;
  size?: RatingSize;
  showEmpty?: boolean;
}) {
  if (value == null) {
    if (!showEmpty) return null;
    return <span className="text-app-muted">--</span>;
  }

  const clamped = Math.max(0, Math.min(5, Math.round(value)));

  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${clamped} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          viewBox="0 0 20 20"
          fill="currentColor"
          className={cn(
            STAR_SIZE_CLASS[size],
            star <= clamped ? 'text-brand-accent dark:text-brand-accent-dark' : 'text-app-border',
          )}
          aria-hidden="true"
        >
          <path d="M10 1.75l2.53 5.12 5.65.82-4.09 3.99.97 5.63L10 14.65l-5.06 2.66.97-5.63-4.09-3.99 5.65-.82L10 1.75z" />
        </svg>
      ))}
    </span>
  );
}

