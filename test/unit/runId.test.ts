import { describe, it, expect } from 'vitest';
import { generateRunId } from '../../src/utils/runId.js';

describe('generateRunId', () => {
  it('returns a string in YYYYMMDD_HHMMSS_6hex format', () => {
    const id = generateRunId();
    expect(id).toMatch(/^\d{8}_\d{6}_[0-9a-f]{6}$/);
  });

  it('generates unique IDs on consecutive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRunId()));
    expect(ids.size).toBe(100);
  });

  it('starts with current date', () => {
    const id = generateRunId();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(id.startsWith(today)).toBe(true);
  });
});
