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
  uploaded: 'bg-slate-100 text-slate-800',
  processing: 'bg-blue-100 text-blue-800',
  needs_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  failed: 'bg-gray-100 text-gray-800',
};

export function StatusChip({ status }: { status: ReceiptUploadStatus }) {
  return (
    <span className={cn('rounded-full px-2 py-1 text-xs font-medium', COLORS[status])}>
      {LABELS[status]}
    </span>
  );
}
