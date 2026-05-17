export const EXTENSION_SUGGESTION_BANNER_STYLES = `
  .extension-suggestion-banner {
    background: var(--color-brand-light);
    color: var(--color-text-primary);
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease, padding 0.3s ease;
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .extension-suggestion-banner--visible {
    max-height: 120px;
    padding: 8px 16px;
  }

  .extension-suggestion-banner__message {
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
  }

  .extension-suggestion-banner__cta {
    flex: 0 0 auto;
    color: var(--color-brand-dark);
    font-weight: 600;
    text-decoration: underline;
  }

  .extension-suggestion-banner__cta:hover {
    color: var(--color-brand);
  }

  .extension-suggestion-banner__close {
    flex: 0 0 auto;
    background: transparent;
    border: none;
    color: var(--color-text-primary);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
  }

  .extension-suggestion-banner__close:hover {
    background: rgba(0, 0, 0, 0.05);
  }
`;
