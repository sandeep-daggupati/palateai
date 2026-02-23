import { AskHandlerInput, AskHandlerOutput } from '@/lib/ask/types';
import { noData } from '@/lib/ask/handlers/_shared';

export async function dishesAtRestaurantHandler(input: AskHandlerInput): Promise<AskHandlerOutput> {
  if (!input.params.restaurant_id || !input.params.restaurant_name) {
    return { answer: 'Which restaurant should I check?' };
  }

  const { data } = await input.service
    .from('dish_entries')
    .select('dish_name')
    .eq('user_id', input.userId)
    .eq('restaurant_id', input.params.restaurant_id)
    .limit(1500);

  const rows = data ?? [];
  if (rows.length === 0) return noData();

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.dish_name, (counts.get(row.dish_name) ?? 0) + 1);
  }

  const list = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');

  return {
    answer: `Your top dishes at ${input.params.restaurant_name}: ${list}.`,
    context_update: {
      lastRestaurantName: input.params.restaurant_name,
      lastRestaurantId: input.params.restaurant_id,
    },
  };
}
