'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FoodDetailContent } from '@/components/food/FoodDetailContent';

type FoodDetailSheetProps = {
  foodKey: string;
};

const GRID_KEYS_STORAGE = 'palate.food.grid.keys';
const SWIPE_THRESHOLD_PX = 50;

export function FoodDetailSheet({ foodKey }: FoodDetailSheetProps) {
  const router = useRouter();
  const [foodKeys, setFoodKeys] = useState<string[]>([]);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(GRID_KEYS_STORAGE);
    if (!raw) {
      setFoodKeys([]);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setFoodKeys(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0));
      }
    } catch {
      setFoodKeys([]);
    }
  }, [foodKey]);

  const currentIndex = useMemo(() => foodKeys.indexOf(foodKey), [foodKey, foodKeys]);

  const navigateByOffset = (offset: number) => {
    if (currentIndex < 0 || foodKeys.length <= 1) return;
    const nextIndex = (currentIndex + offset + foodKeys.length) % foodKeys.length;
    const nextFoodKey = foodKeys[nextIndex];
    if (!nextFoodKey || nextFoodKey === foodKey) return;
    router.replace(`/food/${nextFoodKey}`, { scroll: false });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <button
        type="button"
        aria-label="Close food detail"
        className="absolute inset-0 bg-black/45"
        onClick={() => router.back()}
      />

      <section
        className="relative z-10 max-h-[88vh] w-full rounded-t-2xl border border-app-border bg-app-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl"
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStartX.current == null) return;
          const touchEnd = event.changedTouches[0]?.clientX;
          if (touchEnd == null) return;

          const delta = touchEnd - touchStartX.current;
          if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
          navigateByOffset(delta > 0 ? -1 : 1);
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button type="button" className="text-xs font-medium text-app-link" onClick={() => router.back()}>
            Close
          </button>
          <div className="h-1.5 w-12 rounded-full bg-app-border" />
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous food"
              onClick={() => navigateByOffset(-1)}
              disabled={currentIndex < 0 || foodKeys.length <= 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-app-border text-sm text-app-text disabled:opacity-40"
            >
              {'<'}
            </button>
            <button
              type="button"
              aria-label="Next food"
              onClick={() => navigateByOffset(1)}
              disabled={currentIndex < 0 || foodKeys.length <= 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-app-border text-sm text-app-text disabled:opacity-40"
            >
              {'>'}
            </button>
          </div>
        </div>

        <div className="overflow-y-auto pr-0.5">
          <FoodDetailContent foodKey={foodKey} />
        </div>
      </section>
    </div>
  );
}
