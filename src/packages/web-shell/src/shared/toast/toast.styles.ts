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
`;
