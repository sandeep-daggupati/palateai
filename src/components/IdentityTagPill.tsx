import { Ban, CircleHelp, Gem, RotateCcw, Star, Wine } from 'lucide-react';
import { DishIdentityTag } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

const ICON_STROKE = 1.5;

const IDENTITY_ORDER: DishIdentityTag[] = ['go_to', 'hidden_gem', 'special_occasion', 'try_again', 'never_again'];

const IDENTITY_LABELS: Record<DishIdentityTag, string> = {
  go_to: 'GO-TO',
  hidden_gem: 'Hidden gem',
  special_occasion: 'Special',
  try_again: 'Try again',
  never_again: 'Never again',
};

const IDENTITY_ICONS: Record<DishIdentityTag, typeof Star> = {
  go_to: Star,
  hidden_gem: Gem,
  special_occasion: Wine,
  try_again: RotateCcw,
  never_again: Ban,
};

const IDENTITY_STYLES: Record<DishIdentityTag, string> = {
  go_to: 'border-app-primary/40 bg-app-primary/10 text-app-primary',
  hidden_gem: 'border-app-primary/40 bg-app-primary/10 text-app-primary',
  special_occasion: 'border-app-primary/40 bg-app-primary/10 text-app-primary',
  try_again: 'border-app-border bg-app-card text-app-text',
  never_again: 'border-rose-300/70 bg-rose-50/70 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
};

export function identityTagLabel(tag: DishIdentityTag) {
  return IDENTITY_LABELS[tag];
}

export function identityTagOptions() {
  return IDENTITY_ORDER.map((tag) => ({ value: tag, label: IDENTITY_LABELS[tag] }));
}

export function IdentityTagPill({ tag, className }: { tag: DishIdentityTag | null; className?: string }) {
  if (!tag) {
    return (
      <span className={cn('inline-flex items-center rounded-full border border-app-border bg-app-card px-2 py-1 text-[11px] font-medium text-app-muted', className)}>
        <CircleHelp size={12} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
    );
  }

  const Icon = IDENTITY_ICONS[tag];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold tracking-wide', IDENTITY_STYLES[tag], className)}>
      <Icon size={12} strokeWidth={ICON_STROKE} aria-hidden />
    </span>
  );
}
