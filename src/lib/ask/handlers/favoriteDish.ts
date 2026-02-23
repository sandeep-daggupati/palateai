import { AskHandlerInput, AskHandlerOutput } from '@/lib/ask/types';
import { noData } from '@/lib/ask/handlers/_shared';

export async function favoriteDishHandler(input: AskHandlerInput): Promise<AskHandlerOutput> {
  const { data } = await input.service
    .from('dish_entries')
    .select('dish_name,identity_tag')
    .eq('user_id', input.userId)
    .limit(1500);

  const rows = data ?? [];
  if (rows.length === 0) return noData();

  const goTos = rows.filter((row) => row.identity_tag === 'go_to');
  const source = goTos.length > 0 ? goTos : rows;

  const counts = new Map<string, number>();
  for (const row of source) {
    counts.set(row.dish_name, (counts.get(row.dish_name) ?? 0) + 1);
  }

  const [dishName, count] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];

  const answer = goTos.length > 0
    ? `Looks like your favorite is ${dishName} - you've tagged it GO-TO ${count} time${count === 1 ? '' : 's'}.`
    : `Looks like your most logged dish is ${dishName} (${count} time${count === 1 ? '' : 's'}).`;

  return {
    answer,
    context_update: {
      lastDishName: dishName,
    },
  };
}
