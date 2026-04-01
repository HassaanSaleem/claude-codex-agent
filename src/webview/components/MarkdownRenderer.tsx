import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
// @ts-expect-error ESM-only package; esbuild bundles correctly
import ReactMarkdown from 'react-markdown';
// @ts-expect-error ESM-only package; esbuild bundles correctly
import remarkGfm from 'remark-gfm';
// @ts-expect-error ESM-only package; esbuild bundles correctly
import remarkBreaks from 'remark-breaks';
// @ts-expect-error ESM-only package; esbuild bundles correctly
import type { Components } from 'react-markdown';
// @ts-expect-error ESM-only package; esbuild bundles correctly
import { createHighlighterCore, createCssVariablesTheme, type HighlighterCore } from '@shikijs/core';
// @ts-expect-error ESM-only package; esbuild bundles correctly
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import { sanitizeStreamingMarkdown } from '../../utils/streamSanitizer.js';
import { CodeBlockToolbar } from './CodeBlockToolbar.js';
import type { FileReference } from '../../domain/types.js';

// ── Shiki singleton ──

const cssVarsTheme = createCssVariablesTheme({
  variablePrefix: '--shiki-',
  name: 'css-variables',
});

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [cssVarsTheme],
      langs: [
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/rust'),
        import('@shikijs/langs/go'),
        import('@shikijs/langs/java'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/yaml'),
        import('@shikijs/langs/bash'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/sql'),
        import('@shikijs/langs/markdown'),
        import('@shikijs/langs/diff'),
        import('@shikijs/langs/c'),
        import('@shikijs/langs/cpp'),
      ],
    });
  }
  return highlighterPromise;
}

// ── Props ──

export interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  fileReferences?: FileReference[];
}

// ── Component ──

export function MarkdownRenderer({ content, isStreaming, fileReferences }: MarkdownRendererProps) {
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    getHighlighter().then(setHighlighter).catch(() => {});
  }, []);

  // Throttle streaming updates with useDeferredValue (FR-022, SC-004)
  const deferredContent = useDeferredValue(content);
  const displayContent = isStreaming ? deferredContent : content;

  // Sanitize partial markdown during streaming
  const sanitized = isStreaming
    ? sanitizeStreamingMarkdown(displayContent)
    : displayContent;

  // useMemo must be called unconditionally (Rules of Hooks)
  const components = useMemo(
    () => buildComponents(highlighter, isStreaming, fileReferences),
    [highlighter, isStreaming, fileReferences],
  );

  if (!sanitized) return null;

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
      {sanitized}
    </ReactMarkdown>
  );
}

// ── Custom react-markdown components ──

function buildComponents(
  highlighter: HighlighterCore | null,
  isStreaming?: boolean,
  fileReferences?: FileReference[],
): Components {
  const firstFilePath = fileReferences?.[0]?.path;

  return {
    // Fenced code blocks — wrap with hover toolbar
    pre({ children, ...props }) {
      // Extract code text and language from the child <code> element for the toolbar
      let codeText = '';
      let codeLang = '';
      if (React.isValidElement(children)) {
        const childProps = children.props as { children?: string; className?: string; 'data-code'?: string; 'data-lang'?: string };
        codeText = childProps?.['data-code'] ?? String(childProps?.children ?? '');
        codeLang = childProps?.['data-lang'] ?? '';
      }
      return (
        <pre
          {...props}
          className="code-block-container"
          style={{
            background: 'var(--code-bg)',
            border: '1px solid var(--code-border)',
            borderRadius: 4,
            margin: 'var(--space-2) 0',
            overflow: 'visible',
            position: 'relative',
          }}
        >
          <CodeBlockToolbar
            code={codeText}
            language={codeLang}
            filePath={firstFilePath}
            isStreaming={isStreaming}
          />
          {children}
        </pre>
      );
    },

    code({ className, children, ...props }) {
      // Determine language from className (e.g. "language-typescript")
      const langMatch = className?.match(/language-(\w+)/);
      const lang = langMatch?.[1] ?? '';
      const codeStr = String(children).replace(/\n$/, '');

      // Inline code (no language class)
      if (!langMatch) {
        return (
          <code
            {...props}
            style={{
              background: 'var(--code-bg)',
              padding: '1px 4px',
              borderRadius: 3,
              fontSize: 'var(--code-font-size)',
              fontFamily: 'var(--code-font)',
            }}
          >
            {codeStr}
          </code>
        );
      }

      // Fenced code block — check if we should highlight
      // During streaming, only highlight completed blocks (SC-004)
      const isCompletedBlock = !isStreaming;
      const canHighlight = highlighter && isCompletedBlock && lang;

      // Shared styles for fenced code blocks
      const codeBlockStyle: React.CSSProperties = {
        display: 'block',
        padding: lang ? 'calc(var(--space-2) + 1.2em) var(--space-3) var(--space-2)' : 'var(--space-2) var(--space-3)',
        overflowX: 'auto',
        fontFamily: 'var(--code-font)',
        fontSize: 'var(--code-font-size)',
        lineHeight: 1.5,
        whiteSpace: 'pre',
      };

      const langLabel = lang ? (
        <span
          style={{
            position: 'absolute',
            top: 'var(--space-1)',
            left: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            opacity: 0.5,
            textTransform: 'uppercase',
            userSelect: 'none',
          }}
        >
          {lang}
        </span>
      ) : null;

      if (canHighlight) {
        try {
          const loadedLangs = highlighter.getLoadedLanguages();
          if (loadedLangs.includes(lang)) {
            // Use codeToTokens for XSS-safe React element rendering
            const { tokens } = highlighter.codeToTokens(codeStr, {
              lang,
              theme: 'css-variables',
            });

            return (
              <code data-code={codeStr} data-lang={lang} style={codeBlockStyle}>
                {langLabel}
                {tokens.map((line, i) => (
                  <span key={i}>
                    {line.map((token, j) => (
                      <span key={j} style={{ color: token.color }}>{token.content}</span>
                    ))}
                    {i < tokens.length - 1 && '\n'}
                  </span>
                ))}
              </code>
            );
          }
        } catch {
          // Fallback to plain rendering
        }
      }

      // Plain monospace fallback (unhighlighted or streaming in-progress blocks)
      return (
        <code data-code={codeStr} data-lang={lang} style={codeBlockStyle}>
          {langLabel}
          {codeStr}
        </code>
      );
    },

    // Links — open via VS Code URI handler
    a({ href, children, ...props }) {
      return (
        <a
          {...props}
          href={href}
          style={{ color: 'var(--shiki-token-link)', textDecoration: 'underline' }}
          onClick={(e) => {
            e.preventDefault();
            if (href) {
              // Post message to extension to open URI
              const vscodeApi = (window as any).acquireVsCodeApi?.() ?? (window as any).__vscodeApi;
              if (vscodeApi) {
                vscodeApi.postMessage({ type: 'openFile', path: href });
              }
            }
          }}
        >
          {children}
        </a>
      );
    },

    // Tables
    table({ children, ...props }) {
      return (
        <table
          {...props}
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            margin: 'var(--space-2) 0',
            fontSize: 'var(--text-sm)',
          }}
        >
          {children}
        </table>
      );
    },
    th({ children, ...props }) {
      return (
        <th
          {...props}
          style={{
            border: '1px solid var(--border)',
            padding: 'var(--space-1) var(--space-2)',
            textAlign: 'left',
            fontWeight: 600,
            background: 'var(--code-bg)',
          }}
        >
          {children}
        </th>
      );
    },
    td({ children, ...props }) {
      return (
        <td
          {...props}
          style={{
            border: '1px solid var(--border)',
            padding: 'var(--space-1) var(--space-2)',
            textAlign: 'left',
          }}
        >
          {children}
        </td>
      );
    },

    // Blockquotes
    blockquote({ children, ...props }) {
      return (
        <blockquote
          {...props}
          style={{
            borderLeft: '3px solid var(--button-bg)',
            margin: 'var(--space-2) 0',
            padding: 'var(--space-1) var(--space-3)',
            opacity: 0.85,
          }}
        >
          {children}
        </blockquote>
      );
    },
  };
}
