export const TOAST_STYLES = `.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: calc(100vw - 32px);
  padding: 12px 16px;
  border-radius: var(--radius);
  background: var(--foreground);
  color: var(--background);
  box-shadow: var(--shadow-md);
  /**
   * 1. The toast is a fixed overlay anchored to the bottom, so it can land over
   *    the dark footer (and renders on a dark canvas in dark mode); a faint
   *    white edge keeps it separated from a dark backdrop.
   */
  border: 1px solid rgba(255, 255, 255, 0.3); /* 1 */
  font-size: 0.875rem;
  transition: opacity 300ms ease, transform 300ms ease;
}

/* Added by the global toast script just before removal so the toast fades out
   instead of vanishing. The transform keeps the translateX centring. */
.toast--dismissing {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .toast--dismissing {
    transform: translateX(-50%);
  }
}

.toast__message {
  font-weight: 500;
}

.toast__action-form {
  display: inline;
  margin: 0;
}

.toast__action {
  position: relative;
  padding: var(--button-padding-sm);
  background: var(--primary);
  color: var(--primary-foreground);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.toast__action:hover {
  opacity: 0.9;
}

/**
 * In-flight loader — the toast action (e.g. Undo, a mark-read/unread status
 * POST) triggers the same boosted full-<main> re-swap as the reader's mark-read
 * control, so it shows the same three animated dots while htmx makes the round
 * trip. Scoped to the form's own htmx-request; the button is disabled by
 * hx-disabled-elt during the request (progress cursor, full opacity) and its
 * label is kept in flow via visibility so the button width stays stable.
 */
.toast__action-loader {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  gap: 0.35em;
}

.toast__action-form.htmx-request .toast__action-label {
  visibility: hidden;
}

.toast__action-form.htmx-request .toast__action-loader {
  display: flex;
}

.toast__action:disabled {
  cursor: progress;
  opacity: 1;
}

.toast__action-loader span {
  width: 0.4em;
  height: 0.4em;
  border-radius: 50%;
  background: currentColor;
  animation: toast-action-dot 1.2s ease-in-out infinite both;
}

.toast__action-loader span:nth-child(2) {
  animation-delay: 0.4s;
}

.toast__action-loader span:nth-child(3) {
  animation-delay: 0.8s;
}

@keyframes toast-action-dot {
  0%,
  100% {
    transform: scale(0.5);
  }
  50% {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast__action-loader span {
    animation: none;
  }
}
`;
