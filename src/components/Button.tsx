'use client';

import { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'w-full rounded-xl bg-app-primary px-4 py-3 text-base font-semibold text-app-primary-text shadow-sm transition-colors duration-200 hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-app-accent/80 disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
