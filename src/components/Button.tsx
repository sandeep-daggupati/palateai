'use client';

import { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-app-primary text-app-primary-text shadow-sm hover:bg-app-primary/90 focus:ring-app-accent/70 disabled:bg-app-primary disabled:text-app-primary-text',
  secondary:
    'border border-app-border bg-app-card text-app-text shadow-sm hover:bg-app-card/80 focus:ring-app-accent/60 disabled:border-app-border disabled:bg-app-card disabled:text-app-muted',
  ghost:
    'border border-transparent bg-transparent text-app-text hover:bg-app-card focus:ring-app-accent/60 disabled:text-app-muted',
  danger:
    'border border-transparent bg-rose-700 text-white shadow-sm hover:bg-rose-600 focus:ring-rose-400/60 disabled:bg-rose-700 disabled:text-white',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-10 rounded-xl px-3 text-sm font-medium',
  md: 'h-10 rounded-xl px-4 text-sm font-semibold',
  lg: 'h-10 rounded-xl px-4 text-sm font-semibold',
};

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  fullWidth = true,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-75',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        fullWidth ? 'w-full' : 'w-auto',
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
