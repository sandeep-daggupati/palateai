import { DishIdentityTag } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

const IDENTITY_ORDER: DishIdentityTag[] = ['go_to', 'hidden_gem', 'special_occasion', 'try_again', 'never_again'];

const IDENTITY_LABELS: Record<DishIdentityTag, string> = {
  go_to: '⭐',
  hidden_gem: '💎',
  special_occasion: '🥂',
  try_again: '🔁',
  never_again: '🚫',
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
      <span className={cn('inline-flex rounded-full border border-app-border bg-app-card px-2 py-1 text-[11px] font-medium text-app-muted', className)}>
        ❔
      </span>
    );
  }

  return (
    <span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold tracking-wide', IDENTITY_STYLES[tag], className)}>
      {IDENTITY_LABELS[tag]}
    </span>
  );
}
