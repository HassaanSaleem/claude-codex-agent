import { randomBytes } from 'node:crypto';

export function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const hex = randomBytes(3).toString('hex');
  return `${date}_${time}_${hex}`;
}
