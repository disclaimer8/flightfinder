import { useEffect, useRef, useState, useCallback } from 'react';
import './FilterChip.css';

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

export default function FilterChip({ label, summary, hasValue, onClear, children }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const isMobile = useIsMobile();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Lock body scroll when bottom-sheet is open
  useEffect(() => {
    if (open && isMobile) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = original; };
    }
  }, [open, isMobile]);

  // A11y: when popover opens, move focus to first focusable child (role=dialog
  // expectation per WAI-ARIA). When it closes, return focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const target = dialogRef.current?.querySelector(
      'button, [tabindex="0"], input, select, textarea, [href]'
    );
    target?.focus();
    return () => { triggerRef.current?.focus(); };
  }, [open]);

  const handleClear = useCallback((e) => {
    e.stopPropagation();
    if (onClear) onClear();
  }, [onClear]);

  const triggerLabel = hasValue && summary
    ? `${label}: ${summary}`
    : `+ ${label}`;

  return (
    <div ref={containerRef} className={`filter-chip${hasValue ? ' filter-chip--filled' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="filter-chip-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {triggerLabel}
        {hasValue && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="filter-chip-clear"
            onClick={handleClear}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClear(e); }}
          >
            ✕
          </span>
        )}
      </button>
      {open && (
        <>
          {isMobile && <div className="filter-chip-backdrop" />}
          <div
            ref={dialogRef}
            className={`filter-chip-popover${isMobile ? ' filter-chip-popover--bottom-sheet' : ''}`}
            role="dialog"
            aria-modal={isMobile ? 'true' : undefined}
            aria-label={`${label} options`}
          >
            {isMobile && (
              <div className="filter-chip-popover-header">
                <span>{label}</span>
                <button
                  type="button"
                  className="filter-chip-popover-close"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >×</button>
              </div>
            )}
            {children}
          </div>
        </>
      )}
    </div>
  );
}
