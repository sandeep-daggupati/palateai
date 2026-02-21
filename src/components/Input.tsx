import { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base outline-none ring-slate-200 focus:ring-2',
        className,
      )}
      {...props}
    />
  );
}
