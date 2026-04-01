/**
 * Pre-pipeline triage: detect whether a user message is an actionable task
 * or a conversational/non-task message (greeting, thanks, simple question).
 *
 * Conservative: when in doubt, returns true (treat as task) to avoid
 * false negatives that would skip the pipeline for real tasks.
 */

const GREETING_PATTERNS = /^(hi|hey|hello|howdy|yo|sup|hiya|good\s*(morning|afternoon|evening|night)|what'?s\s*up|greetings)\b/i;

const THANKS_PATTERNS = /^(thanks?|thank\s*you|thx|ty|cheers|much\s*appreciated|great|nice|cool|awesome|perfect|ok(ay)?|got\s*it|sounds?\s*good|noted|understood|will\s*do)\b[.!]?$/i;

const SIMPLE_QUESTION_PATTERNS = /^(what|who|where|when|why|how|is|are|was|were|do|does|did|can|could|would|should|will)\b/i;

const TASK_VERBS = /^(add|create|build|implement|fix|refactor|update|change|modify|delete|remove|move|rename|write|set\s*up|setup|install|configure|deploy|migrate|convert|extract|split|merge|replace|rewrite|optimize|improve|debug|test|lint|format|generate|scaffold|integrate|connect|wire|hook|enable|disable|make|put|insert|append|prepend)\b/i;

const TASK_INTENT_PATTERNS = /^(can\s+you|could\s+you|please|i\s+need|i\s+want|we\s+need|we\s+should|let'?s|go\s+ahead\s+and)\b/i;

export function isLikelyTask(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/);

  // Short messages (≤ 3 words) that start with a task verb → task
  if (words.length <= 3 && TASK_VERBS.test(trimmed)) return true;

  // Known non-task: greetings
  if (GREETING_PATTERNS.test(trimmed) && words.length <= 5) return false;

  // Known non-task: thanks / acknowledgments (entire message)
  if (THANKS_PATTERNS.test(trimmed)) return false;

  // Short messages (≤ 3 words) without task verb → not a task
  if (words.length <= 3 && !TASK_VERBS.test(trimmed)) return false;

  // Messages that start with a task verb → task
  if (TASK_VERBS.test(trimmed)) return true;

  // Messages with task intent phrasing ("can you add...", "please fix...")
  if (TASK_INTENT_PATTERNS.test(trimmed) && words.length > 3) return true;

  // Simple questions without task intent (≤ 8 words) → not a task
  if (SIMPLE_QUESTION_PATTERNS.test(trimmed) && words.length <= 8) {
    // But if the question contains a task verb after the question word, it's a task
    const afterFirstWord = words.slice(1).join(' ');
    if (TASK_VERBS.test(afterFirstWord)) return true;
    // "can you add X" style already caught by TASK_INTENT_PATTERNS
    return false;
  }

  // Default: treat as task (conservative — avoid false negatives)
  return true;
}
