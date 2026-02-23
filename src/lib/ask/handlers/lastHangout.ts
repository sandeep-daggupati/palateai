import { AskHandlerInput, AskHandlerOutput } from '@/lib/ask/types';
import { formatDate, getRestaurantNameById, noData } from '@/lib/ask/handlers/_shared';

export async function lastHangoutHandler(input: AskHandlerInput): Promise<AskHandlerOutput> {
  let query = input.service
    .from('receipt_uploads')
    .select('id,restaurant_id,visited_at,created_at')
    .eq('user_id', input.userId)
    .order('visited_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (input.params.restaurant_id) {
    query = query.eq('restaurant_id', input.params.restaurant_id);
  }

  const { data } = await query.maybeSingle();
  if (!data) return noData();

  const restaurantName = data.restaurant_id ? await getRestaurantNameById(input.service, data.restaurant_id) : null;
  const dateLabel = formatDate(data.visited_at ?? data.created_at);

  return {
    answer: `Your last hangout${restaurantName ? ` at ${restaurantName}` : ''} was ${dateLabel}.`,
    context_update: {
      lastHangoutId: data.id,
      lastRestaurantId: data.restaurant_id ?? null,
      lastRestaurantName: restaurantName,
    },
  };
}
