import { cn } from '@/lib/utils';

type RatingSize = 'sm' | 'md';

const STAR_SIZE_CLASS: Record<RatingSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
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
    return <span className={cn('text-app-muted', STAR_SIZE_CLASS[size])}>--</span>;
  }

  const clamped = Math.max(0, Math.min(5, Math.round(value)));

  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${clamped} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={cn(
            STAR_SIZE_CLASS[size],
            star <= clamped ? 'text-brand-accent dark:text-brand-accent-dark' : 'text-app-border',
          )}
          aria-hidden="true"
        >
          ?
        </span>
      ))}
    </span>
  );
}
