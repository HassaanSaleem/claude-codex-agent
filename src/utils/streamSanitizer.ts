/**
 * Sanitize partial markdown for streaming display.
 *
 * Closes unclosed code fences so react-markdown can parse
 * incomplete streaming content without layout breaks.
 * Applied in the render path only — stored content is unmodified.
 */
export function sanitizeStreamingMarkdown(partial: string): string {
  if (!partial) return partial;

  // Count fenced code block delimiters (``` only, not inline backticks)
  const fencePattern = /^(`{3,})/gm;
  let fenceCount = 0;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(partial)) !== null) {
    fenceCount++;
  }

  // If odd number of fences, the last code block is unclosed — close it
  if (fenceCount % 2 !== 0) {
    // Ensure there's a newline before the closing fence
    const endsWithNewline = partial.endsWith('\n');
    return partial + (endsWithNewline ? '' : '\n') + '```';
  }

  return partial;
}
