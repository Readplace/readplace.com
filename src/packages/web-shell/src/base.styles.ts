const LIGHT_THEME_VARIABLES: Record<string, string> = {
	"--color-background": "#FFFFFF",
	"--color-surface": "#F7F8FA",
	"--color-surface-elevated": "#FFFFFF",
	"--color-text-primary": "#1A202C",
	"--color-text-secondary": "#5A6170",
	"--color-text-muted": "#8C919D",
	"--color-border": "#E2E5EA",
	"--color-brand": "#C8702A",
	"--color-brand-dark": "#A85A1E",
	"--color-brand-light": "#F5E6D3",
	"--color-secondary": "#2B3A55",
	"--color-highlight": "#C8923C",
	"--color-success": "#3D8B6E",
	"--color-warning": "#C8923C",
	"--color-error": "#C45C5C",
	"--shadow-sm": "0 1px 2px rgba(0,0,0,0.05)",
	"--shadow-md": "0 4px 6px rgba(0,0,0,0.07)",
	"--primary": "hsl(27 65% 47%)",
	"--primary-text": "var(--color-brand-dark)",
	/** Amber dark enough to carry --primary-foreground at 5.06:1, so it is pinned
	 * across both themes: a fill and a text colour need opposite lightness as the
	 * page darkens, and --primary-text follows the page. */
	"--primary-fill": "#A85A1E",
	"--primary-foreground": "hsl(0 0% 100%)",
	"--secondary": "hsl(27 30% 95%)",
	"--secondary-foreground": "hsl(27 65% 35%)",
	"--background": "var(--color-background)",
	"--foreground": "var(--color-text-primary)",
	"--muted": "var(--color-surface)",
	"--muted-foreground": "var(--color-text-secondary)",
	"--success": "var(--color-success)",
	/** --color-success is 4.10:1 on white, short of 1.4.3. Same hue and
	 * saturation, darkened to 4.98:1, for success wording rather than surfaces. */
	"--success-text": "hsl(158 39% 35%)",
	"--success-foreground": "hsl(0 0% 100%)",
	"--border": "var(--color-border)",
	"--card": "var(--color-surface-elevated)",
	"--card-foreground": "var(--color-text-primary)",
	"--accent": "hsl(27 65% 47%)",
	"--accent-foreground": "hsl(0 0% 100%)",
	"--radius-sm": "6px",
	"--radius": "8px",
	"--radius-lg": "12px",
	"--reader-max-width": "680px",
	"--input": "var(--color-border)",
	"--ring": "hsl(27 65% 47%)",
	"--ring-shadow": "hsl(27 65% 47% / 0.15)",
	"--error": "hsl(0 43% 56%)",
	/** --error is 4.17:1 on white, short of 1.4.3. Same hue, darkened to 5.2:1,
	 * for error wording rather than error surfaces. */
	"--error-text": "hsl(0 43% 50%)",
	"--error-foreground": "hsl(0 0% 100%)",
	"--error-bg": "hsl(0 43% 56% / 0.1)",
	"--warning-bg": "hsl(37 56% 51% / 0.12)",
	"--input-height": "48px",
	"--input-padding": "12px 16px",
	"--input-font-size": "16px",
	"--form-gap": "20px",
	"--button-padding": "12px 24px",
	"--button-padding-sm": "8px 16px",
	"--button-padding-xs": "4px 8px",
	"--button-padding-x": "24px",
	"--color-on-brand": "#FFFFFF",
	"--header-brand-stem": "var(--color-secondary)",
	"--header-brand-tail": "var(--color-brand)",
	"--footer-bg": "#1A1A1A",
	"--footer-text": "hsl(0 0% 100% / 0.7)",
	"--footer-link": "hsl(0 0% 100% / 0.9)",
	"--footer-link-hover": "hsl(0 0% 100%)",
	"--footer-copyright": "hsl(0 0% 100% / 0.5)",
};

const DARK_THEME_VARIABLES: Record<string, string> = {
	"--color-background": "#121212",
	"--color-surface": "#1A1A1A",
	"--color-surface-elevated": "#222222",
	"--color-text-primary": "#E4E4E4",
	"--color-text-secondary": "#9BA1AE",
	"--color-text-muted": "#6B6B6B",
	"--color-border": "#2E2E2E",
	"--color-brand": "#D4833A",
	"--color-brand-dark": "#E89A55",
	"--color-brand-light": "#3D2A18",
	"--color-secondary": "#2B3A55",
	"--color-highlight": "#D4A04A",
	"--color-success": "#4A9F7F",
	"--color-warning": "#D4A04A",
	"--color-error": "#D46B6B",
	"--shadow-sm": "0 1px 2px rgba(0,0,0,0.3)",
	"--shadow-md": "0 4px 6px rgba(0,0,0,0.4)",
	"--primary": "hsl(27 65% 52%)",
	"--primary-text": "var(--color-brand)",
	"--secondary": "hsl(27 15% 18%)",
	"--secondary-foreground": "hsl(27, 65%, 35%)",
	"--accent": "hsl(27 65% 52%)",
	"--ring": "hsl(27 65% 52%)",
	"--ring-shadow": "hsl(27 65% 52% / 0.25)",
	"--success-text": "var(--color-success)",
	"--error-text": "var(--color-error)",
	"--error-bg": "hsl(0 43% 56% / 0.15)",
	"--warning-bg": "hsl(37 62% 56% / 0.18)",
	"--header-brand-stem": "var(--color-text-primary)",
	"--header-brand-tail": "var(--color-highlight)",
	"--footer-bg": "#0D0D0D",
};

function generateCssVariables(variables: Record<string, string>): string {
	return Object.entries(variables)
		.map(([key, value]) => `    ${key}: ${value};`)
		.join("\n");
}

export const BASE_CSS_VARIABLES = `
  :root {
    color-scheme: light;
${generateCssVariables(LIGHT_THEME_VARIABLES)}
  }

  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
${generateCssVariables(DARK_THEME_VARIABLES)}
    }
  }

  @media (min-width: 768px) {
    :root {
      --form-gap: 24px;
    }
  }
`;

export const BASE_RESET_STYLES = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  html {
    scroll-padding-top: calc(var(--banner-area-height, 38px) + var(--header-height, 64px));
  }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: var(--foreground);
    min-height: 100vh;
    padding-top: var(--banner-area-height, 38px);
  }
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
`;

export const HEADER_STYLES = `
  .header {
    background: var(--background);
    border-bottom: 1px solid var(--border);
    padding: 16px 20px;
    position: sticky;
    top: var(--banner-area-height, 38px);
    z-index: 100;
    transition: transform 0.25s ease;
  }
  /* Reader views slide the nav offscreen on scroll-down (reader-nav.client.ts).
     -100% is exactly the header's height — the same distance the sticky mark-read
     toolbar rises — so the two move in lockstep with no content gap. The strip
     left at the very top is covered by the opaque fixed .banner-area (z-index 200
     > 100); keep it -100%, not -100% - banner, or a text sliver flashes through. */
  .nav-hidden .header {
    transform: translateY(-100%);
  }
  @media (prefers-reduced-motion: reduce) {
    .header {
      transition: none;
    }
  }
  .header--transparent {
    background: transparent;
    border-bottom: none;
    position: absolute;
    top: var(--banner-area-height, 38px);
    left: 0;
    right: 0;
  }
  .header__content {
    max-width: 1000px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .header__brand {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--header-brand-stem);
    text-decoration: none;
    letter-spacing: -0.02em;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .header__brand-icon {
    width: 26px;
    height: 26px;
    flex-shrink: 0;
  }
  .header__brand-mark {
    color: var(--header-brand-tail);
  }
  .header--transparent .header__brand {
    color: var(--color-on-brand);
  }
  .header--transparent .header__brand-mark {
    color: var(--color-highlight);
  }
`;

export const FOOTER_STYLES = `
  .footer {
    background: var(--footer-bg);
    color: var(--footer-text);
    padding: 24px 20px;
    margin-top: auto;
  }

  .footer__content {
    max-width: 1000px;
    margin: 0 auto;
    text-align: center;
  }

  .footer__links {
    list-style: none;
    display: flex;
    justify-content: center;
    gap: 24px;
    margin: 0 0 12px 0;
    padding: 0;
  }

  .footer__link {
    color: var(--footer-link);
    text-decoration: none;
    font-size: 0.875rem;
  }

  .footer__link:hover {
    color: var(--footer-link-hover);
  }

  .footer__copyright {
    font-size: 0.6875rem;
    color: var(--footer-copyright);
    margin: 0;
  }
`;

export const OFFLINE_BANNER_STYLES = `
  .offline-banner {
    background: var(--color-warning);
    color: var(--foreground);
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease, padding 0.3s ease;
    padding: 0 16px;
  }

  .offline-banner--visible {
    max-height: 50px;
    padding: 8px 16px;
  }

  .offline-banner__icon {
    display: inline-block;
    vertical-align: middle;
    margin-right: 8px;
  }
`;

export const NAV_STYLES = `
  .nav {
    position: relative;
  }

  .nav__toggle {
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    width: 24px;
    height: 20px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .nav__toggle-bar {
    width: 100%;
    height: 2px;
    background: var(--foreground);
    border-radius: 1px;
    transition: transform 0.2s ease, opacity 0.2s ease;
  }

  .header--transparent .nav__toggle-bar {
    background: var(--color-on-brand);
  }

  .nav__toggle[aria-expanded="true"] .nav__toggle-bar:nth-child(1) {
    transform: translateY(9px) rotate(45deg);
  }

  .nav__toggle[aria-expanded="true"] .nav__toggle-bar:nth-child(2) {
    opacity: 0;
  }

  .nav__toggle[aria-expanded="true"] .nav__toggle-bar:nth-child(3) {
    transform: translateY(-9px) rotate(-45deg);
  }

  .nav__menu {
    display: none;
    position: absolute;
    top: 100%;
    right: 0;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    min-width: 180px;
    margin-top: 8px;
    z-index: 101;
  }

  .nav__menu--open {
    display: block;
  }

  /**
   * 1. Sibling groups are split by a hairline so the sections read as distinct
   *    without a heading on every one (the heading is the .nav__group-label).
   */
  .nav__group {
    padding: 8px 0;
  }

  .nav__group + .nav__group {
    border-top: 1px solid var(--border); /* 1 */
  }

  .nav__group-label {
    display: block;
    padding: 4px 16px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  /**
   * 1. Ensure font-size of nav-list is consistent to avoid different sizes when wrapped by a form, like the logout
   */
  .nav__list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 14px; /* 1 */
  }

  .nav__link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    color: var(--foreground);
    text-decoration: none;
  }

  .nav__icon-wrap {
    position: relative;
    flex-shrink: 0;
    display: inline-flex;
    justify-content: center;
    width: 1.1em;
  }

  .nav__icon {
    flex-shrink: 0;
    width: 1.1em;
    text-align: center;
    font-size: 0.95em;
    color: var(--muted-foreground);
  }

  .nav__badge {
    position: absolute;
    top: -7px;
    left: -9px;
    padding: 2px 4px;
    background: var(--color-error);
    color: var(--color-on-brand);
    font-size: 8px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border-radius: var(--radius-sm);
    pointer-events: none;
  }

  .nav__link:hover {
    background: var(--muted);
  }

  button.nav__link {
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    width: 100%;
    text-align: left;
  }

  @media (max-width: 767px) {
    .header--transparent .nav__menu {
      background: var(--background);
      border: 1px solid var(--border);
    }
    .header--transparent .nav__link {
      color: var(--foreground);
    }
    .header--transparent .nav__icon {
      color: var(--muted-foreground);
    }
  }

  @media (min-width: 768px) {
    .nav__toggle {
      display: none;
    }

    .nav__menu {
      display: flex;
      align-items: center;
      gap: 8px;
      position: static;
      background: transparent;
      border: none;
      box-shadow: none;
      min-width: auto;
      margin-top: 0;
    }

    .nav__group {
      display: flex;
      align-items: center;
      padding: 0;
    }

    /**
     * 1. Visually hidden on the horizontal bar (the grouping reads from the
     *    divider + spacing), but kept in the accessibility tree so screen
     *    readers still announce the section heading.
     */
    .nav__group-label {
      position: absolute; /* 1 */
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .nav__group + .nav__group {
      border-top: none;
      border-left: 1px solid var(--border);
      margin-left: 8px;
      padding-left: 8px;
    }

    .nav__list {
      display: flex;
      gap: 8px;
    }

    .nav__link {
      padding: 8px 12px;
      border-radius: var(--radius);
    }

    .header--transparent .nav__group + .nav__group {
      border-left-color: rgba(255, 255, 255, 0.25);
    }

    .header--transparent .nav__link,
    .header--transparent .nav__icon {
      color: var(--color-on-brand);
    }

    .header--transparent .nav__link:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  }
`;

export const TRIAL_COUNTDOWN_STYLES = `
  .trial-countdown {
    margin: 0;
    padding: 0 12px;
    color: var(--color-error);
    font-weight: 600;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
    text-decoration: none;
    transition: color 0.3s ease, background 0.3s ease, font-weight 0.3s ease;
  }

  .trial-countdown:hover {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  /* purgecss-ignore-start: modifier suffix is interpolated from BannerState.trial.escalation, the cancellation branch of escalationClassFor in nav.component.ts, and the visibility state in nav.template.ts */
  .trial-countdown--visible {
    display: inline-block;
  }

  .trial-countdown--hidden {
    display: none;
  }

  .trial-countdown--soft {
    font-weight: 500;
    opacity: 0.85;
  }

  .trial-countdown--moderate {
    font-weight: 600;
  }

  .trial-countdown--urgent {
    font-weight: 700;
    padding: 2px 10px;
    background: var(--error-bg);
    border-radius: var(--radius-sm);
  }

  .trial-countdown--critical {
    font-weight: 700;
    padding: 2px 10px;
    background: var(--color-error);
    color: var(--error-foreground);
    border-radius: var(--radius-sm);
    animation: trial-countdown-pulse 1.5s ease-in-out infinite;
  }

  .trial-countdown--expired {
    font-weight: 700;
    padding: 2px 10px;
    background: var(--color-error);
    color: var(--error-foreground);
    border-radius: var(--radius-sm);
    animation: trial-countdown-shake 0.5s ease-in-out 1;
  }

  .trial-countdown--cancellation-scheduled,
  .trial-countdown--cancellation-imminent {
    font-weight: 500;
    padding: 2px 10px;
    background: var(--warning-bg);
    color: var(--foreground);
    border-radius: var(--radius-sm);
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .trial-countdown--cancellation-imminent {
    font-weight: 700;
    background: var(--error-bg);
    color: var(--color-error);
  }
  /* purgecss-ignore-end */

  @keyframes trial-countdown-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.04); }
  }

  @keyframes trial-countdown-shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-2px); }
    75% { transform: translateX(2px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .trial-countdown {
      transition: none;
      animation: none !important;
    }
  }

  /** Below 960px the inline header row (brand + horizontal nav) leaves the chip
   * less than its ~150px minimum, so it moves to its own full-width row. The
   * wrap is scoped with :has() to the cancellation state so every other trial
   * state keeps today's single-row layout; browsers without :has() fall back
   * to the ellipsized inline chip, whose title still carries the full text. */
  @media (max-width: 959px) {
    .header__content:has(.trial-countdown--cancellation-scheduled),
    .header__content:has(.trial-countdown--cancellation-imminent) {
      flex-wrap: wrap;
    }

    .trial-countdown--cancellation-scheduled,
    .trial-countdown--cancellation-imminent {
      flex-basis: 100%;
      order: 99;
      padding: 4px 10px;
    }
  }

  @media (max-width: 480px) {
    .header__content {
      flex-wrap: wrap;
    }

    .trial-countdown {
      flex-basis: 100%;
      padding: 4px 0 0;
      order: 99;
    }

    .trial-countdown--cancellation-scheduled,
    .trial-countdown--cancellation-imminent {
      padding: 4px 10px;
    }
  }
`;

export const VERIFY_BANNER_STYLES = `
  .verify-banner {
    background: var(--color-warning);
    color: var(--foreground);
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    padding: 8px 16px;
  }

  .verify-banner--visible { display: block; }
  .verify-banner--hidden { display: none; }

  .verify-banner--locked {
    background: var(--color-error);
    color: var(--error-foreground);
    font-weight: 600;
  }

  .verify-banner__count { font-weight: 700; }

  .verify-banner__contact {
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
  }
`;

export const BANNER_AREA_STYLES = `
  .banner-area {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 200;
  }
`;

/**
 * `--banner-area-height` reserves vertical space for the *fixed* `.banner-area`
 * — `body` pads by it so content clears the bar. The chromeless shell has no
 * fixed bar (its announcement rides in normal flow), so nothing needs reserving
 * and the correct height is zero. Without this the 38px fallback strands a dead
 * strip above the announcement, and above the article when there is none.
 */
export const CHROMELESS_BANNER_AREA_STYLES = `
  :root {
    --banner-area-height: 0px;
  }
`;

export const CHANGELOG_BANNER_STYLES = `
  .changelog-banner {
    background: var(--color-surface-elevated);
    border-bottom: 1px solid var(--color-border);
    color: var(--foreground);
    font-size: 14px;
    line-height: 1.5;
    box-shadow: var(--shadow-sm);
  }

  .changelog-banner--visible { display: block; }
  .changelog-banner--hidden { display: none; }

  .changelog-banner__inner {
    max-width: 1000px;
    margin: 0 auto;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /**
   * 1. A label, not a pill — 6px radius (var(--radius-sm)) keeps it inside the
   *    brand's "never fully rounded" rule while the navy fill carries novelty.
   * 2. Navy (the secondary brand colour) so the chip reads as "unseen" against
   *    the amber chrome that links and CTAs already own, without colliding with
   *    --color-success (which means "saved"). The inline seen-script adds
   *    --seen on a version this browser has already seen, dropping the chip so
   *    NEW signals novelty rather than merely "not yet dismissed".
   */
  .changelog-banner__chip {
    flex: 0 0 auto;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    padding: 4px 7px;
    background: var(--color-secondary); /* 2 */
    color: var(--color-on-brand);
    border-radius: var(--radius-sm); /* 1 */
  }

  .changelog-banner--seen .changelog-banner__chip { display: none; }

  .changelog-banner__hook {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }

  .changelog-banner__link {
    flex: 0 0 auto;
    color: var(--primary);
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }

  .changelog-banner__link:hover,
  .changelog-banner__link:focus-visible {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  .changelog-banner__dismiss {
    flex: 0 0 auto;
    margin: 0;
    line-height: 1;
  }

  .changelog-banner__close {
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: var(--button-padding-xs);
    border-radius: var(--radius-sm);
    transition: color 0.15s ease, background 0.15s ease;
  }

  .changelog-banner__close:hover,
  .changelog-banner__close:focus-visible {
    color: var(--foreground);
    background: var(--color-surface);
  }

  @media (max-width: 480px) {
    .changelog-banner__hook {
      white-space: normal;
    }
  }
`;


export const UTILITY_STYLES = `
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;
