import { ReceiptUploadStatus } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

const LABELS: Record<ReceiptUploadStatus, string> = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  needs_review: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
  failed: 'Failed',
};

const COLORS: Record<ReceiptUploadStatus, string> = {
  uploaded: 'border-app-border bg-app-card text-app-muted',
  processing: 'border-app-primary/35 bg-app-primary/10 text-app-primary',
  needs_review: 'border-amber-300/70 bg-amber-50/80 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
  approved: 'border-emerald-300/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300',
  rejected: 'border-rose-300/70 bg-rose-50/80 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  failed: 'border-zinc-300/70 bg-zinc-100/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300',
};

export function StatusChip({ status }: { status: ReceiptUploadStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', COLORS[status])}>
      {LABELS[status]}
    </span>
  );
}
