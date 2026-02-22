import { cn } from '@/lib/utils';

type FilterOption<T extends string> = {
  label: string;
  value: T;
  badge?: string;
};

export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: Array<FilterOption<T>>;
  selected: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {options.map((option) => {
        const isSelected = option.value === selected;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors duration-200',
              isSelected
                ? 'border-app-primary bg-app-primary text-app-primary-text'
                : 'border-app-border bg-app-card text-app-muted hover:border-app-primary/30 hover:text-app-text',
            )}
          >
            <span>{option.label}</span>
            {option.badge && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  isSelected
                    ? 'bg-app-primary-text/20 text-app-primary-text'
                    : 'border border-app-border bg-app-card text-app-muted',
                )}
              >
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
