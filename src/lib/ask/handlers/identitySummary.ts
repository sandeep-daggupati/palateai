import { AskHandlerInput, AskHandlerOutput } from '@/lib/ask/types';
import { noData } from '@/lib/ask/handlers/_shared';

export async function identitySummaryHandler(input: AskHandlerInput): Promise<AskHandlerOutput> {
  const days = input.params.timeframe_days ?? 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data } = await input.service
    .from('dish_entries')
    .select('identity_tag,eaten_at,created_at')
    .eq('user_id', input.userId)
    .limit(2000);

  const filtered = (data ?? []).filter((row) => {
    const stamp = row.eaten_at ?? row.created_at;
    return new Date(stamp).getTime() >= cutoff.getTime();
  });

  if (filtered.length === 0) return noData();

  const counts = new Map<string, number>();
  for (const row of filtered) {
    const key = row.identity_tag ?? 'unlabeled';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const summary = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => `${tag.replace(/_/g, ' ')}: ${count}`)
    .join(', ');

  return {
    answer: `In the last ${days} days, your identity tags look like this: ${summary}.`,
  };
}
