import { describe, it, expect } from 'vitest';
import { parseDiffStats, exceedsBudget } from '../../src/utils/patchBudget.js';

const sampleDiff = `--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,7 @@
 line 1
-old line 2
-old line 3
+new line 2
+new line 3
+new line 4
 line 5
+added line`;

describe('parseDiffStats', () => {
  it('counts added and removed lines', () => {
    const stats = parseDiffStats(sampleDiff);
    expect(stats.linesAdded).toBe(4);
    expect(stats.linesRemoved).toBe(2);
    expect(stats.totalChanged).toBe(6);
  });

  it('ignores +++ and --- file headers', () => {
    const diff = `--- a/foo.ts\n+++ b/foo.ts\n+added`;
    const stats = parseDiffStats(diff);
    expect(stats.linesAdded).toBe(1);
    expect(stats.linesRemoved).toBe(0);
  });

  it('returns zeros for empty diff', () => {
    const stats = parseDiffStats('');
    expect(stats.totalChanged).toBe(0);
  });
});

describe('exceedsBudget', () => {
  it('returns false when under budget', () => {
    expect(exceedsBudget(sampleDiff, 100)).toBe(false);
  });

  it('returns true when over budget', () => {
    expect(exceedsBudget(sampleDiff, 3)).toBe(true);
  });

  it('returns false when exactly at budget', () => {
    expect(exceedsBudget(sampleDiff, 6)).toBe(false);
  });
});
