export const EXTENSION_SUGGESTION_BANNER_STYLES = `
  .extension-suggestion-banner {
    background: linear-gradient(135deg, #2B3A55 0%, #1E2A40 100%);
    color: #FFFFFF;
    font-size: 14px;
    line-height: 1.5;
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease, padding 0.3s ease;
    padding: 0 16px;
    box-shadow: var(--shadow-md);
  }

  .extension-suggestion-banner--visible {
    max-height: 320px;
    padding: 14px 16px;
    animation: extension-suggestion-banner-slide-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes extension-suggestion-banner-slide-in {
    from {
      transform: translateY(-100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .extension-suggestion-banner--visible {
      animation: none;
    }
  }

  .extension-suggestion-banner__inner {
    max-width: 1000px;
    margin: 0 auto;
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 14px;
    align-items: start;
    padding-right: 36px;
  }

  .extension-suggestion-banner__marker {
    position: relative;
    width: 10px;
    height: 10px;
    margin-top: 7px;
    border-radius: 50%;
    background: var(--color-highlight);
    box-shadow: 0 0 0 4px rgba(200, 146, 60, 0.18);
  }

  .extension-suggestion-banner__marker::before {
    content: "";
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    pointer-events: none;
    background: radial-gradient(circle, rgba(200, 146, 60, 0.55) 0%, rgba(200, 146, 60, 0) 70%);
    filter: blur(3px);
    animation: extension-suggestion-banner-marker-breathe 2.6s ease-in-out infinite;
  }

  @keyframes extension-suggestion-banner-marker-breathe {
    0%, 100% {
      filter: blur(2px);
      opacity: 0.65;
      transform: scale(0.95);
    }
    25% {
      filter: blur(5px);
      opacity: 0.95;
      transform: scale(1.1);
    }
    50% {
      filter: blur(3px);
      opacity: 0.75;
      transform: scale(1);
    }
    75% {
      filter: blur(6px);
      opacity: 1;
      transform: scale(1.15);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .extension-suggestion-banner__marker::before {
      animation: none;
    }
  }

  .extension-suggestion-banner__content {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .extension-suggestion-banner__message {
    margin: 0;
    color: rgba(255, 255, 255, 0.92);
  }

  .extension-suggestion-banner__inline {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: rgba(255, 255, 255, 0.6);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    border-radius: 2px;
    transition: text-decoration-color 0.15s ease;
  }

  .extension-suggestion-banner__inline:hover,
  .extension-suggestion-banner__inline:focus-visible {
    text-decoration-color: #FFFFFF;
  }

  .extension-suggestion-banner__cta {
    display: block;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    background: var(--color-brand);
    color: var(--color-on-brand);
    font-weight: 600;
    text-decoration: none;
    padding: 10px 16px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-brand);
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }

  .extension-suggestion-banner__cta:hover,
  .extension-suggestion-banner__cta:focus-visible {
    background: var(--color-brand-dark);
    border-color: var(--color-brand-dark);
    transform: translateY(-1px);
  }

  .extension-suggestion-banner__close {
    position: absolute;
    top: 0;
    right: 0;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    transition: color 0.15s ease, background 0.15s ease;
  }

  .extension-suggestion-banner__close:hover,
  .extension-suggestion-banner__close:focus-visible {
    color: #FFFFFF;
    background: rgba(255, 255, 255, 0.08);
  }

  @media (min-width: 768px) {
    .extension-suggestion-banner__content {
      flex-direction: row;
      align-items: center;
      gap: 20px;
    }

    .extension-suggestion-banner__message {
      flex: 1 1 auto;
      min-width: 0;
    }

    .extension-suggestion-banner__cta {
      width: auto;
      flex: 0 0 auto;
      padding: 8px 18px;
    }
  }
`;
