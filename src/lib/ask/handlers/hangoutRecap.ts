import { AskHandlerInput, AskHandlerOutput } from '@/lib/ask/types';
import { getRestaurantNameById, noData } from '@/lib/ask/handlers/_shared';

export async function hangoutRecapHandler(input: AskHandlerInput): Promise<AskHandlerOutput> {
  const hangoutId = input.params.hangout_id;
  if (!hangoutId) {
    return {
      answer: "Which hangout do you mean? Try: 'last hangout at Popeyes'.",
    };
  }

  const { data } = await input.service
    .from('dish_entries')
    .select('dish_name,quantity,restaurant_id,had_it')
    .eq('user_id', input.userId)
    .eq('source_upload_id', hangoutId)
    .neq('had_it', false)
    .limit(200);

  const dishes = data ?? [];
  if (dishes.length === 0) return noData();

  const restaurantId = dishes[0].restaurant_id;
  const restaurantName = restaurantId ? await getRestaurantNameById(input.service, restaurantId) : null;
  const list = dishes
    .slice(0, 6)
    .map((dish) => `${dish.dish_name}${dish.quantity && dish.quantity > 1 ? ` x${dish.quantity}` : ''}`)
    .join(', ');

  return {
    answer: `${restaurantName ? `${restaurantName} recap` : 'Hangout recap'}: ${list}.`,
    context_update: {
      lastHangoutId: hangoutId,
      lastRestaurantId: restaurantId ?? null,
      lastRestaurantName: restaurantName,
      lastDishName: dishes[0].dish_name,
    },
  };
}
