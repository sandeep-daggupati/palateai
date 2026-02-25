import { AskHandlerInput, AskHandlerOutput, NO_PRICE_DATA_MESSAGE } from '@/lib/ask/types';
import { formatDate, getRestaurantNameById } from '@/lib/ask/handlers/_shared';

export async function cheapestLoggedItemHandler(input: AskHandlerInput): Promise<AskHandlerOutput> {
  const keyword = input.params.dish_keyword?.trim() ?? null;

  let query = input.service
    .from('dish_entries')
    .select('dish_name,price_original,currency_original,source_upload_id,restaurant_id,eaten_at,created_at')
    .eq('user_id', input.userId)
    .not('price_original', 'is', null)
    .order('price_original', { ascending: true })
    .limit(25);

  if (keyword) {
    query = query.ilike('dish_name', `%${keyword}%`);
  }

  if (input.params.restaurant_id) {
    query = query.eq('restaurant_id', input.params.restaurant_id);
  }

  const { data } = await query;
  const rows = (data ?? []).filter((row) => typeof row.price_original === 'number' && row.price_original >= 0);

  if (rows.length === 0) {
    return { answer: NO_PRICE_DATA_MESSAGE };
  }

  const cheapest = rows[0];
  const restaurantName = cheapest.restaurant_id ? await getRestaurantNameById(input.service, cheapest.restaurant_id) : null;
  const price = cheapest.price_original ?? 0;
  const currency = cheapest.currency_original || '$';
  const dateLabel = formatDate(cheapest.eaten_at ?? cheapest.created_at);

  return {
    answer: keyword
      ? `Your cheapest logged ${keyword} is ${cheapest.dish_name} for ${currency} ${price.toFixed(2)}${restaurantName ? ` at ${restaurantName}` : ''} on ${dateLabel}.`
      : `Your cheapest logged item is ${cheapest.dish_name} for ${currency} ${price.toFixed(2)}${restaurantName ? ` at ${restaurantName}` : ''} on ${dateLabel}.`,
    context_update: {
      lastDishName: keyword ?? cheapest.dish_name,
      lastHangoutId: cheapest.source_upload_id,
      lastRestaurantId: cheapest.restaurant_id ?? null,
      lastRestaurantName: restaurantName,
    },
  };
}
