import { Ban, Gem, Minus, RotateCcw, Star, Wine } from 'lucide-react';
import { DishIdentityTag } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

type CanonicalIdentityTag = DishIdentityTag | 'none';

const ICON_STROKE = 1.6;

const IDENTITY_ICON: Record<CanonicalIdentityTag, typeof Star> = {
  go_to: Star,
  hidden_gem: Gem,
  special_occasion: Wine,
  try_again: RotateCcw,
  never_again: Ban,
  none: Minus,
};

const IDENTITY_LABEL: Record<CanonicalIdentityTag, string> = {
  go_to: 'Go-to',
  hidden_gem: 'Hidden gem',
  special_occasion: 'Special occasion',
  try_again: 'Try again',
  never_again: 'Never again',
  none: 'No tag',
};

export function identityTagTooltip(tag: CanonicalIdentityTag): string {
  return IDENTITY_LABEL[tag];
}

export function IdentityTagIcon({
  tag,
  className,
  size = 14,
  showNone = false,
}: {
  tag: CanonicalIdentityTag;
  className?: string;
  size?: number;
  showNone?: boolean;
}) {
  if (tag === 'none' && !showNone) return null;

  const Icon = IDENTITY_ICON[tag];

  return (
    <span
      title={identityTagTooltip(tag)}
      aria-label={identityTagTooltip(tag)}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-full border border-app-border bg-app-card text-app-muted',
        tag !== 'none' && 'text-app-primary',
        className,
      )}
    >
      <Icon size={size} strokeWidth={ICON_STROKE} aria-hidden />
    </span>
  );
}
