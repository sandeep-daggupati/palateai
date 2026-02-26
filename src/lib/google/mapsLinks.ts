export function getGoogleMapsLink(
  placeId: string | null | undefined,
  address: string | null | undefined,
  fallbackQuery?: string | null,
): string | null {
  const query = (address?.trim() || fallbackQuery?.trim() || 'restaurant').trim();

  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${encodeURIComponent(placeId)}`;
  }

  if (query.length > 0) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  return null;
}
