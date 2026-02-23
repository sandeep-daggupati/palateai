import { AskHandlerInput, AskHandlerOutput } from '@/lib/ask/types';
import { noData } from '@/lib/ask/handlers/_shared';

export async function mostVisitedRestaurantHandler(input: AskHandlerInput): Promise<AskHandlerOutput> {
  const days = input.params.timeframe_days;
  let query = input.service
    .from('receipt_uploads')
    .select('restaurant_id,visited_at,created_at')
    .eq('user_id', input.userId)
    .not('restaurant_id', 'is', null)
    .limit(2000);

  if (days && days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    query = query.gte('created_at', cutoff.toISOString());
  }

  const { data } = await query;
  const rows = data ?? [];
  if (rows.length === 0) return noData();

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.restaurant_id) continue;
    counts.set(row.restaurant_id, (counts.get(row.restaurant_id) ?? 0) + 1);
  }

  if (counts.size === 0) return noData();

  const [restaurantId, visits] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const { data: restaurant } = await input.service.from('restaurants').select('name').eq('id', restaurantId).maybeSingle();
  const restaurantName = restaurant?.name ?? 'that spot';

  return {
    answer: `Your most visited spot is ${restaurantName} with ${visits} hangouts.`,
    context_update: {
      lastRestaurantId: restaurantId,
      lastRestaurantName: restaurantName,
    },
  };
}
