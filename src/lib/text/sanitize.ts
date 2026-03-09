export function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return '';

  let text = value
    .normalize('NFKC')
    .replace(/\uFFFD/g, '');

  const replacements: Array<[RegExp, string]> = [
    [/Ã¢â‚¬â€œ/g, '–'],
    [/Ã¢â‚¬â€\x9d/g, '—'],
    [/Ã¢â‚¬â„¢/g, '’'],
    [/Ã¢â‚¬Å“/g, '“'],
    [/Ã¢â‚¬\x9d/g, '”'],
    [/Ãƒâ€”/g, '×'],
    [/Ã—/g, '×'],
    [/Ã‚Â·/g, '·'],
    [/Â·/g, '·'],
    [/Â/g, ''],
  ];

  for (const [pattern, next] of replacements) {
    text = text.replace(pattern, next);
  }

  return text.replace(/\s+/g, ' ').trim();
}

export function sanitizeNullableText(value: unknown): string | null {
  const cleaned = sanitizeText(value);
  return cleaned.length > 0 ? cleaned : null;
}
