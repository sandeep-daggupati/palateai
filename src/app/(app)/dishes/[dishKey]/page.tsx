'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry } from '@/lib/supabase/types';

export default function DishProfilePage() {
  const params = useParams<{ dishKey: string }>();
  const [entries, setEntries] = useState<DishEntry[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const { data } = await supabase
        .from('dish_entries')
        .select('*')
        .eq('dish_key', params.dishKey)
        .order('created_at', { ascending: true });
      setEntries((data ?? []) as DishEntry[]);
    };

    load();
  }, [params.dishKey]);

  const trend = useMemo(() => {
    if (entries.length < 2) return null;
    const first = entries[0].price_usd ?? 0;
    const last = entries[entries.length - 1].price_usd ?? 0;
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    return { first, last, changePct };
  }, [entries]);

  return (
    <div className="space-y-4 pb-8">
      <h1 className="text-xl font-bold">Dish profile</h1>
      {trend && (
        <div className="card-surface text-sm">
          <p>First price: ${trend.first.toFixed(2)}</p>
          <p>Latest price: ${trend.last.toFixed(2)}</p>
          <p>Change: {trend.changePct.toFixed(1)}%</p>
        </div>
      )}
      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.id} className="card-surface text-sm">
            <p className="font-medium">{entry.dish_name}</p>
            <p>${entry.price_original?.toFixed(2) ?? '—'}</p>
            <p className="text-xs text-slate-500">{new Date(entry.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

