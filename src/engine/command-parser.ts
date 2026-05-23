export function extractCommand(note: unknown): string {
  const match = String(note || '').trim().match(/^\/[a-z0-9-]+/i);
  if (!match) return '';
  const command = match[0].toLowerCase();
  if (command === '/command') return '/commands';
  return command;
}

export function commandPayload(note: unknown): string {
  return String(note || '').trim().replace(/^\/[a-z0-9-]+\s*/i, '').trim();
}
