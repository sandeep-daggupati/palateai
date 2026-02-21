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
  uploaded: 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100',
  processing: 'bg-sky-200 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100',
  needs_review: 'bg-amber-200 text-amber-900 dark:bg-amber-800/60 dark:text-amber-100',
  approved: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
  rejected: 'bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100',
  failed: 'bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100',
};

export function StatusChip({ status }: { status: ReceiptUploadStatus }) {
  return (
    <span className={cn('rounded-full px-2 py-1 text-xs font-semibold', COLORS[status])}>
      {LABELS[status]}
    </span>
  );
}
