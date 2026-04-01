import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD = 50; // px from bottom considered "at bottom"

/**
 * Auto-scroll hook that keeps a scrollable container pinned to the bottom
 * while new content streams in, unless the user has manually scrolled up.
 *
 * @param containerRef  Ref to the scrollable container element
 * @param scrollTrigger A value that changes whenever the container should
 *                      re-check and auto-scroll (e.g. message count + content length).
 *                      This is the primary scroll driver — more reliable than
 *                      MutationObserver alone since it's React-aware.
 */
export function useAutoScroll(containerRef: React.RefObject<HTMLElement | null>, scrollTrigger?: unknown) {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const userScrolledUp = useRef(false);
  const rafId = useRef<number>(0);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    userScrolledUp.current = false;
    setIsAtBottom(true);
  }, [containerRef]);

  // Listen for user scroll events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
      setIsAtBottom(atBottom);
      userScrolledUp.current = !atBottom;
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [containerRef]);

  // Primary auto-scroll: fires whenever scrollTrigger changes (every stream
  // chunk, every new message). Uses requestAnimationFrame to batch with the
  // browser paint cycle and avoid forced layout thrashing.
  useEffect(() => {
    if (userScrolledUp.current) return;
    const el = containerRef.current;
    if (!el) return;

    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [scrollTrigger, containerRef]);

  // Fallback: MutationObserver for DOM changes not covered by scrollTrigger
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new MutationObserver(() => {
      if (!userScrolledUp.current) {
        el.scrollTop = el.scrollHeight;
      }
    });

    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [containerRef]);

  // Clean up rAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  return { isAtBottom, scrollToBottom };
}
