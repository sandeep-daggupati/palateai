export function getGoogleMapsLink(
  placeId: string | null | undefined,
  address: string | null | undefined,
  lat?: number | null,
  lng?: number | null,
  fallbackQuery?: string | null,
  placeType?: 'google' | 'pinned' | null,
): string | null {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const coordQuery = hasCoords ? `${lat},${lng}` : null;
  const query = (coordQuery || address?.trim() || fallbackQuery?.trim() || 'restaurant').trim();

  if (placeType === 'pinned' && coordQuery) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordQuery)}`;
  }

  if (placeId && placeType !== 'pinned') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${encodeURIComponent(placeId)}`;
  }

  if (query.length > 0) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  return null;
}
