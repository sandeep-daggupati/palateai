import { AskHandlerInput, AskHandlerOutput } from '@/lib/ask/types';
import { noData } from '@/lib/ask/handlers/_shared';

export async function goTosLatelyHandler(input: AskHandlerInput): Promise<AskHandlerOutput> {
  const days = input.params.timeframe_days ?? 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data } = await input.service
    .from('dish_entries')
    .select('dish_name,eaten_at,created_at')
    .eq('user_id', input.userId)
    .eq('identity_tag', 'go_to')
    .limit(1500);

  const recentRows = (data ?? []).filter((row) => {
    const stamp = row.eaten_at ?? row.created_at;
    return new Date(stamp).getTime() >= cutoff.getTime();
  });

  if (recentRows.length === 0) return noData();

  const counts = new Map<string, number>();
  for (const row of recentRows) {
    counts.set(row.dish_name, (counts.get(row.dish_name) ?? 0) + 1);
  }

  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (top.length === 0) return noData();

  return {
    answer: `Your GO-TOs in the last ${days} days: ${top.map(([name, count]) => `${name} (${count})`).join(', ')}.`,
    context_update: {
      lastDishName: top[0][0],
    },
  };
}
