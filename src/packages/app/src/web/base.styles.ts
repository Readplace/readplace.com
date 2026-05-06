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
	"--color-highlight": "#C8923C",
	"--color-success": "#3D8B6E",
	"--color-warning": "#C8923C",
	"--color-error": "#C45C5C",
	"--shadow-sm": "0 1px 2px rgba(0,0,0,0.05)",
	"--shadow-md": "0 4px 6px rgba(0,0,0,0.07)",
	"--primary": "hsl(27 65% 47%)",
	"--primary-foreground": "hsl(0 0% 100%)",
	"--secondary": "hsl(27 30% 95%)",
	"--secondary-foreground": "hsl(27 65% 35%)",
	"--background": "var(--color-background)",
	"--foreground": "var(--color-text-primary)",
	"--muted": "var(--color-surface)",
	"--muted-foreground": "var(--color-text-secondary)",
	"--success": "var(--color-success)",
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
	"--error-foreground": "hsl(0 0% 100%)",
	"--error-bg": "hsl(0 43% 56% / 0.1)",
	"--input-height": "48px",
	"--input-padding": "12px 16px",
	"--input-font-size": "16px",
	"--form-gap": "20px",
	"--color-on-brand": "#FFFFFF",
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
	"--color-highlight": "#D4A04A",
	"--color-success": "#4A9F7F",
	"--color-warning": "#D4A04A",
	"--color-error": "#D46B6B",
	"--shadow-sm": "0 1px 2px rgba(0,0,0,0.3)",
	"--shadow-md": "0 4px 6px rgba(0,0,0,0.4)",
	"--primary": "hsl(27 65% 52%)",
	"--secondary": "hsl(27 15% 18%)",
	"--secondary-foreground": "hsl(27, 65%, 35%)",
	"--accent": "hsl(27 65% 52%)",
	"--ring": "hsl(27 65% 52%)",
	"--ring-shadow": "hsl(27 65% 52% / 0.25)",
	"--error-bg": "hsl(0 43% 56% / 0.15)",
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
    color: var(--primary);
    text-decoration: none;
    letter-spacing: -0.02em;
  }
  .header__brand-mark {
    color: var(--color-highlight);
  }
  .header--transparent .header__brand {
    color: var(--color-on-brand);
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

  .nav__list {
    list-style: none;
    margin: 0;
    padding: 8px 0;
  }

  /**
   * 1. Ensure font-size of nav-list is consistent to avoid different sizes when wrapped by a form, like the logout
   */
  .nav__list {
    font-size: 14px; /* 1 */
  }

  .nav__link {
    display: block;
    padding: 12px 16px;
    color: var(--foreground);
    text-decoration: none;
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
  }

  @media (min-width: 768px) {
    .nav__toggle {
      display: none;
    }

    .nav__menu {
      display: block;
      position: static;
      background: transparent;
      border: none;
      box-shadow: none;
      min-width: auto;
      margin-top: 0;
    }

    .nav__list {
      display: flex;
      gap: 8px;
      padding: 0;
    }

    .nav__link {
      padding: 8px 12px;
      border-radius: var(--radius);
    }

    .header--transparent .nav__link {
      color: var(--color-on-brand);
    }

    .header--transparent .nav__link:hover {
      background: rgba(255, 255, 255, 0.1);
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
