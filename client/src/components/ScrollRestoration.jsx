// client/src/components/ScrollRestoration.jsx
import { useLayoutEffect } from 'react';

/**
 * Restores window.scrollY from history.state after results paint.
 * Used by /search to return to the same scroll position when the user
 * navigates back from a flight detail page.
 *
 * Saving the scrollY happens elsewhere (FlightCard onClick) — this
 * component only handles the restore side.
 *
 * Props:
 * - ready: boolean. Only restore when true (i.e. after flights are
 *   rendered, otherwise we'd scrollTo a position that doesn't exist
 *   yet because the page is still tall enough).
 */
export default function ScrollRestoration({ ready }) {
  useLayoutEffect(() => {
    if (!ready) return;
    const state = window.history.state;
    const savedY = state?.scrollY;
    if (typeof savedY !== 'number') return;

    requestAnimationFrame(() => {
      window.scrollTo(0, savedY);
    });

    // One-shot: clear so a manual refresh doesn't keep restoring.
    const { scrollY: _, ...rest } = state;
    window.history.replaceState(rest, '');
  }, [ready]);

  return null;
}
