import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SpecFeature } from '../domain/types.js';
import type { ISpecService } from '../domain/interfaces.js';

const SPECS_DIR = 'specs';
const MAX_SLUG_LENGTH = 40;
const MAX_SLUG_WORDS = 5;

/** Common filler words stripped before slugifying user input. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'they',
  'me', 'us', 'him', 'her', 'them', 'my', 'our', 'your', 'his',
  'not', 'no', 'so', 'if', 'then', 'than', 'when', 'where', 'how', 'what',
  'which', 'who', 'whom', 'why', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'same', 'also', 'just',
  'about', 'above', 'after', 'again', 'before', 'below', 'between',
  'during', 'into', 'through', 'under', 'until', 'up', 'down', 'out',
  'over', 'very', 'too', 'here', 'there', 'now', 'as', 'like',
  'want', 'make', 'made', 'get', 'got', 'let', 'put', 'set',
  'please', 'thanks', 'sure', 'okay', 'ok',
  'implement', 'add', 'create', 'build', 'update', 'change', 'modify',
  'feature', 'new', 'support', 'functionality',
]);

export class SpecService implements ISpecService {
  async resolveFeatureDirectory(taskDescription: string, workspacePath: string): Promise<SpecFeature> {
    const specsRoot = path.join(workspacePath, SPECS_DIR);
    await fs.mkdir(specsRoot, { recursive: true });

    const featureSlug = this.slugify(taskDescription);

    // Atomically claim a directory by retrying if mkdir races with another caller
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const featureNumber = await this.nextFeatureNumber(specsRoot);
      const dirName = `${this.padFeatureNumber(featureNumber)}-${featureSlug}`;
      const specDir = path.join(specsRoot, dirName);

      try {
        // Non-recursive mkdir will throw EEXIST if another caller raced us
        await fs.mkdir(specDir);

        // Directory claimed successfully — create subdirectories
        await fs.mkdir(path.join(specDir, 'stages'), { recursive: true });
        await fs.mkdir(path.join(specDir, 'checklists'), { recursive: true });
        await fs.mkdir(path.join(specDir, 'contracts'), { recursive: true });

        return {
          featureNumber,
          featureSlug,
          specDir,
          taskDescription,
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Another caller claimed this number — retry with next number
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Failed to claim spec directory after ${maxRetries} attempts`);
  }

  private padFeatureNumber(n: number): string {
    // 3-digit padding for numbers < 1000, otherwise use natural width
    return String(n).padStart(3, '0');
  }

  private async nextFeatureNumber(specsRoot: string): Promise<number> {
    let highest = 0;
    try {
      const entries = await fs.readdir(specsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Match any leading digits followed by a hyphen
        const match = entry.name.match(/^(\d+)-/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > highest) highest = num;
        }
      }
    } catch {
      // Directory doesn't exist yet — start at 0
    }
    return highest + 1;
  }

  private slugify(text: string): string {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0 && !STOP_WORDS.has(w));

    // Take up to MAX_SLUG_WORDS meaningful words, then enforce char limit
    return words
      .slice(0, MAX_SLUG_WORDS)
      .join('-')
      .slice(0, MAX_SLUG_LENGTH)
      .replace(/-$/, '');
  }
}
