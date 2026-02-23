import { AskContext, AskHandlerInput, AskHandlerOutput, NO_DATA_MESSAGE } from '@/lib/ask/types';

export function mergeContext(base: AskContext, patch?: Partial<AskContext>): AskContext {
  return {
    lastRestaurantName: patch?.lastRestaurantName ?? base.lastRestaurantName,
    lastRestaurantId: patch?.lastRestaurantId ?? base.lastRestaurantId,
    lastHangoutId: patch?.lastHangoutId ?? base.lastHangoutId,
    lastDishName: patch?.lastDishName ?? base.lastDishName,
    lastIntent: patch?.lastIntent ?? base.lastIntent,
  };
}

export async function resolveRestaurantByName(
  service: AskHandlerInput['service'],
  userId: string,
  restaurantName: string,
): Promise<{ id: string; name: string; place_id: string | null } | null> {
  const { data } = await service
    .from('restaurants')
    .select('id,name,place_id')
    .eq('user_id', userId)
    .ilike('name', `%${restaurantName}%`)
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

export async function getRestaurantNameById(service: AskHandlerInput['service'], restaurantId: string): Promise<string | null> {
  const { data } = await service.from('restaurants').select('name').eq('id', restaurantId).maybeSingle();
  return data?.name ?? null;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleDateString();
}

export function noData(): AskHandlerOutput {
  return { answer: NO_DATA_MESSAGE };
}
