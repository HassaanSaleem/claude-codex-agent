import * as path from 'node:path';
import { BINARY_EXTENSIONS, SENSITIVE_PATTERNS } from '../domain/constants.js';

/**
 * Check if a file is binary based on its extension.
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if a file matches a known sensitive file pattern.
 * Supports exact match and simple glob (* wildcard).
 */
export function isSensitiveFile(filePath: string): boolean {
  const fileName = path.basename(filePath);
  const lowerFileName = fileName.toLowerCase();

  for (const pattern of SENSITIVE_PATTERNS) {
    const lowerPattern = pattern.toLowerCase();

    // Exact match
    if (lowerFileName === lowerPattern) return true;

    // Glob with * wildcard — convert to regex
    if (lowerPattern.includes('*')) {
      const escaped = lowerPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      const re = new RegExp(`^${escaped}$`);
      if (re.test(lowerFileName)) return true;
    }
  }

  return false;
}

/**
 * Fuzzy match a query against a file path.
 * Returns a relevance score (0 = no match, higher = better).
 */
export function fuzzyMatch(query: string, filePath: string): number {
  if (!query) return 1; // Empty query matches everything with base score

  const lowerQuery = query.toLowerCase();
  const lowerPath = filePath.toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();

  // No match at all if query chars aren't found in sequence
  let qi = 0;
  for (let pi = 0; pi < lowerPath.length && qi < lowerQuery.length; pi++) {
    if (lowerPath[pi] === lowerQuery[qi]) qi++;
  }
  if (qi < lowerQuery.length) return 0;

  let score = 1;

  // Exact filename match bonus
  if (fileName === lowerQuery) return 200;

  // Filename starts with query
  if (fileName.startsWith(lowerQuery)) score += 50;

  // Filename contains query as substring
  if (fileName.includes(lowerQuery)) score += 30;

  // Full path contains query as substring
  if (lowerPath.includes(lowerQuery)) score += 10;

  // Consecutive character bonus
  let maxConsecutive = 0;
  let consecutive = 0;
  qi = 0;
  for (let pi = 0; pi < lowerPath.length && qi < lowerQuery.length; pi++) {
    if (lowerPath[pi] === lowerQuery[qi]) {
      consecutive++;
      qi++;
      if (consecutive > maxConsecutive) maxConsecutive = consecutive;
    } else {
      consecutive = 0;
    }
  }
  score += maxConsecutive * 2;

  return score;
}
