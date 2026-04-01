export interface PatchStats {
  linesAdded: number;
  linesRemoved: number;
  totalChanged: number;
}

export function parseDiffStats(diff: string): PatchStats {
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      linesAdded++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      linesRemoved++;
    }
  }

  return {
    linesAdded,
    linesRemoved,
    totalChanged: linesAdded + linesRemoved,
  };
}

export function exceedsBudget(diff: string, budget: number): boolean {
  const stats = parseDiffStats(diff);
  return stats.totalChanged > budget;
}
