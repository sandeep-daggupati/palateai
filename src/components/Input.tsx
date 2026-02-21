import { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-app-border bg-app-card px-3 py-2 text-base text-app-text outline-none transition-colors duration-200 placeholder:text-app-muted focus:border-app-primary focus:ring-2 focus:ring-app-accent/70',
        className,
      )}
      {...props}
    />
  );
}
