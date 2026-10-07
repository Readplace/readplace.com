import assert from "node:assert";

const LIGHT_THEME_VARIABLES: Record<string, string> = {
	"--font-sans":
		"Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
	"--font-serif": 'Georgia, "Times New Roman", serif',
	"--font-mono": "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
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
	"--warning-text": "hsl(37 56% 40%)",
	"--color-error": "#C45C5C",
	"--color-info": "#4A7FB5",
	"--shadow-sm": "0 1px 2px rgba(0,0,0,0.05)",
	"--shadow-md": "0 4px 6px rgba(0,0,0,0.07)",
	"--shadow-menu": "0 0 8px rgb(0 0 0 / 0.15)",
	"--shadow-toast": "0 4px 16px rgba(0,0,0,0.12)",
	"--text-xs": "0.75rem",
	"--text-sm": "0.875rem",
	"--text-md": "1rem",
	"--text-lg": "1.125rem",
	/** Amber dark enough to carry --primary-foreground at 4.61:1 — the lightest
	* step of hsl(27 65% L%) that clears 4.5:1, so the CTA stays as warm as the
	* label allows. Pinned across both themes for the same reason --primary-fill
	* is: a fill and a text colour need opposite lightness as the page darkens,
	* and --primary-text is the one that follows the page. */
	"--primary": "hsl(27 65% 41%)",
	"--primary-hover": "hsl(27 65% 37%)",
	"--primary-text": "var(--color-brand-dark)",
	"--primary-text-on-tint": "hsl(27 65% 30%)",
	"--color-secondary-text": "var(--color-secondary)",
	/** The active step below --primary, at 6.49:1, pinned the same way. */
	"--primary-fill": "hsl(27 65% 33%)",
	"--primary-foreground": "hsl(0 0% 100%)",
	"--secondary": "var(--color-brand-light)",
	"--secondary-hover": "#EED7BA",
	"--secondary-pressed": "#E6C9A3",
	"--secondary-foreground": "hsl(27 65% 35%)",
	"--neutral-hover": "#F7F8FA",
	"--neutral-pressed": "#EDEFF2",
	"--background": "var(--color-background)",
	"--foreground": "var(--color-text-primary)",
	"--muted": "var(--color-surface)",
	"--muted-foreground": "var(--color-text-secondary)",
	"--success": "var(--color-success)",
	/** --color-success is 4.10:1 on white, short of 1.4.3. Same hue and
	 * saturation, darkened to 4.98:1, for success wording rather than surfaces. */
	"--success-text": "hsl(158 39% 35%)",
	"--success-foreground": "hsl(0 0% 100%)",
	"--success-bg": "#E8F2EE",
	"--info-bg": "#E8EFF7",
	"--border": "var(--color-border)",
	"--card": "var(--color-surface-elevated)",
	"--card-foreground": "var(--color-text-primary)",
	"--radius-sm": "6px",
	"--radius": "8px",
	"--radius-md": "12px",
	"--radius-lg": "16px",
	"--radius-pill": "999px",
	"--reader-max-width": "680px",
	"--input": "var(--color-border)",
	"--ring": "hsl(27 65% 47%)",
	"--ring-shadow": "hsl(27 65% 47% / 0.15)",
	"--error": "hsl(0 43% 56%)",
	/** --error is 4.17:1 on white, short of 1.4.3. Same hue, darkened,
	* for error wording rather than error surfaces. */
	"--error-text": "hsl(0 43% 48%)",
	/** Red dark enough to carry --error-foreground at 4.85:1, so it is pinned
	* across both themes: a fill and a text colour need opposite lightness as the
	* page darkens, and --error-text follows the page. */
	"--error-fill": "hsl(0 43% 52%)",
	"--error-fill-hover": "hsl(0 43% 44%)",
	"--error-foreground": "hsl(0 0% 100%)",
	"--error-bg": "#F6E7E7",
	"--warning-bg": "var(--color-brand-light)",
	"--announcement-bg": "#1A202C",
	"--announcement-link": "#D4833A",
	"--progress-track": "var(--border)",
	"--progress-fill": "var(--success)",
	"--fact-site": "var(--color-secondary-text)",
	"--fact-saved": "var(--color-error)",
	"--fact-read-time": "var(--color-success)",
	"--ink-nav-current": "var(--foreground)",
	"--ink-nav-inactive": "var(--muted-foreground)",
	"--ink-meta": "var(--foreground)",
	"--ink-tab-inactive": "var(--foreground)",
	"--ink-rail-heading": "var(--muted-foreground)",
	"--ink-pagination": "var(--muted-foreground)",
	"--input-height": "48px",
	"--input-padding": "12px",
	"--input-placeholder": "var(--muted-foreground)",
	"--button-padding": "12px 24px",
	"--button-padding-sm": "8px 16px",
	"--button-padding-xs": "4px 8px",
	"--button-padding-x": "24px",
	"--color-on-brand": "#FFFFFF",
	"--color-avatar": "#7C5CE6",
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
	"--warning-text": "var(--color-warning)",
	"--color-error": "#D46B6B",
	"--color-info": "#6B9BD1",
	"--shadow-sm": "0 1px 2px rgba(0,0,0,0.3)",
	"--shadow-md": "0 4px 6px rgba(0,0,0,0.4)",
	"--shadow-menu": "0 0 8px rgb(0 0 0 / 0.5)",
	"--shadow-toast": "0 4px 16px rgba(0,0,0,0.5)",
	"--primary-text": "hsl(27 65% 58%)",
	"--primary-text-on-tint": "#EAA162",
	"--color-secondary-text": "#8FA3C8",
	"--secondary-hover": "#4A3320",
	"--secondary-pressed": "#5A3E26",
	"--secondary-foreground": "hsl(27, 65%, 35%)",
	"--neutral-hover": "#2A2A2A",
	"--neutral-pressed": "#2E2E2E",
	"--ring": "hsl(27 65% 52%)",
	"--ring-shadow": "hsl(27 65% 52% / 0.25)",
	"--success-text": "var(--color-success)",
	"--success-bg": "#17302A",
	"--info-bg": "#1B2836",
	"--error-text": "hsl(0 43% 68%)",
	"--error-bg": "#3A2020",
	"--color-avatar": "#8F7AF0",
	"--header-brand-stem": "var(--color-text-primary)",
	"--header-brand-tail": "var(--color-highlight)",
	"--footer-bg": "#0D0D0D",
};

const FORM_SIZE_VARIABLES: Record<string, string> = {
	"--input-font-size": "16px",
	"--form-gap": "20px",
};

function generateCssVariables(variables: Record<string, string>): string {
	return Object.entries(variables)
		.map(([key, value]) => `    ${key}: ${value};`)
		.join("\n");
}

/**
 * The class the shell stamps on a page that must render light whatever the
 * viewer's system theme is. Dark mode is a signed-in reader's setting: the
 * logged-out surfaces are designed art — a navy hero, a warm call to action —
 * and a system-driven flip repaints them into a scheme nobody designed.
 */
export const LIGHT_ONLY_BODY_CLASS = "theme-light";

export const DARK_ONLY_BODY_CLASS = "theme-dark";

export const DISTRACTION_FREE_BODY_CLASS = "page-distraction-free";

export type AppearanceSetting = "system" | "light" | "dark";

const APPEARANCE_BODY_CLASS: Record<AppearanceSetting, string | undefined> = {
	system: undefined,
	light: LIGHT_ONLY_BODY_CLASS,
	dark: DARK_ONLY_BODY_CLASS,
};

export function appearanceBodyClass(
	bodyClass: string | undefined,
	appearance: AppearanceSetting,
): string {
	const classes = [bodyClass, APPEARANCE_BODY_CLASS[appearance]];
	return classes.filter((name): name is string => name !== undefined).join(" ");
}

/**
 * Pins the light palette under {@link LIGHT_ONLY_BODY_CLASS}. Generated from the
 * same token map the default theme uses, so a token added there cannot be missed
 * here.
 */
const LIGHT_ONLY_STYLES = `
	@media (prefers-color-scheme: dark) {
		:root:has(> body.${LIGHT_ONLY_BODY_CLASS}) {
			color-scheme: light;
		}

		body.${LIGHT_ONLY_BODY_CLASS} {
			color-scheme: light;
${generateCssVariables(LIGHT_THEME_VARIABLES)}
		}
	}
`;

const DARK_PINNED_VARIABLES = { ...LIGHT_THEME_VARIABLES, ...DARK_THEME_VARIABLES };

const DARK_ONLY_STYLES = `
	:root:has(> body.${DARK_ONLY_BODY_CLASS}) {
		color-scheme: dark;
	}

	body.${DARK_ONLY_BODY_CLASS} {
		color-scheme: dark;
${generateCssVariables(DARK_PINNED_VARIABLES)}
	}
`;

export const SYSTEM_THEME_VARIABLES = `
	:root {
		color-scheme: light;
${generateCssVariables(LIGHT_THEME_VARIABLES)}
${generateCssVariables(FORM_SIZE_VARIABLES)}
	}

	@media (prefers-color-scheme: dark) {
		:root {
			color-scheme: dark;
${generateCssVariables(DARK_THEME_VARIABLES)}
		}
	}
`;

export const BASE_CSS_VARIABLES = `${SYSTEM_THEME_VARIABLES}
	:root {
		--frame-max-width: 1200px;
		--page-gutter: 20px;
		--page-top: 20px;
		--stack-gap: 24px;
		--column-gap: 24px;
		--header-inset: 20px;
	}

	@media (min-width: 768px) {
		:root {
			--form-gap: 24px;
			--page-gutter: 24px;
			--page-top: 24px;
			--header-inset: 24px;
		}
	}

	@media (min-width: 1200px) {
		:root {
			--page-gutter: 48px;
			--page-top: 32px;
			--stack-gap: 32px;
			--column-gap: 48px;
			--header-inset: 48px;
		}
	}

	@media (min-width: 768px) and (pointer: fine) {
		:root {
			--input-font-size: 14px;
		}
	}
${LIGHT_ONLY_STYLES}
${DARK_ONLY_STYLES}
`;

function lightThemeValue(variable: string): string {
	const value = LIGHT_THEME_VARIABLES[variable];
	assert(value, `${variable} must be defined in the light theme`);
	return value;
}

export const EMAIL_FRAME_CANVAS = {
	background: lightThemeValue("--color-background"),
	text: lightThemeValue("--color-text-primary"),
	fontFamily: lightThemeValue("--font-sans"),
};

export const SCRIM_LIGHT = "rgb(0 0 0 / 0.5)";

export const SCRIM_DARK = "rgb(13 13 13 / 0.72)";

export const SCRIM_BLUR = "2px";

export const BASE_RESET_STYLES = `
	* {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}
	html {
		scroll-padding-top: calc(var(--banner-area-height, 52px) + var(--header-height, 72px));
	}
	body {
		font-family: var(--font-sans);
		line-height: 1.6;
		color: var(--foreground);
		background: var(--background);
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		padding-top: var(--banner-area-height, 52px);
	}
	body > main {
		width: 100%;
	}
	body > main.htmx-swapping {
		overflow-anchor: none;
	}
	button:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
`;

export const BUTTON_STYLES = `
	.btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 48px;
		padding: 12px 16px;
		border: none;
		border-radius: var(--radius);
		font-family: inherit;
		font-size: var(--text-md);
		font-weight: 600;
		line-height: 1.5;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.btn > svg {
		width: 1.25rem;
		height: 1.25rem;
		flex: none;
	}

	.btn--m {
		min-height: 40px;
		padding: 8px 14px;
	}

	.btn--m::before {
		content: "";
		position: absolute;
		inset: -2px 0;
	}

	.btn--s {
		gap: 6px;
		min-height: 32px;
		padding: 6px 12px;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		line-height: 1.25rem;
	}

	.btn--s > svg {
		width: 1rem;
		height: 1rem;
	}

	.btn--s::before {
		content: "";
		position: absolute;
		inset: -6px 0;
	}

	.btn--primary {
		background: var(--primary);
		color: var(--primary-foreground);
	}

	.btn--primary:hover {
		background: var(--primary-hover);
	}

	.btn--primary:active {
		background: var(--primary-fill);
	}

	.btn--secondary {
		background: var(--secondary);
		color: var(--primary-text-on-tint);
		box-shadow: inset 0 0 0 1px var(--color-brand);
	}

	.btn--secondary:hover {
		background: var(--secondary-hover);
	}

	.btn--secondary:active {
		background: var(--secondary-pressed);
	}

	.btn--destructive {
		background: var(--card);
		color: var(--error-text);
		box-shadow: inset 0 0 0 1px var(--color-error);
		transition: background-color 0.15s ease, color 0.15s ease;
	}

	.btn--destructive:hover {
		background: var(--error-fill);
		color: var(--error-foreground);
	}

	.btn--destructive:active {
		background: var(--error-fill-hover);
		color: var(--error-foreground);
	}

	.btn--neutral {
		background: var(--card);
		color: var(--foreground);
		box-shadow: inset 0 0 0 1px var(--border);
	}

	.btn--neutral:hover {
		background: var(--neutral-hover);
	}

	.btn--neutral:active {
		background: var(--neutral-pressed);
	}

	.btn--on-dark {
		background: var(--color-on-brand);
		color: var(--secondary-foreground);
	}

	.btn--on-dark:hover,
	.btn--on-dark:active {
		background: color-mix(in srgb, var(--secondary-foreground) 10%, var(--color-on-brand));
	}

	.btn--on-dark-ghost {
		background: rgba(255, 255, 255, 0.15);
		color: var(--color-on-brand);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
	}

	.btn--on-dark-ghost:hover,
	.btn--on-dark-ghost:active {
		background: rgba(255, 255, 255, 0.28);
	}

	.btn:disabled,
	.btn[aria-disabled="true"] {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:where(form.htmx-request) .btn:disabled {
		opacity: 1;
		cursor: progress;
	}

	.btn__label-stack {
		display: inline-grid;
	}

	.btn__label-stack > *,
	.btn__label-stack::before,
	.btn__label-stack::after {
		grid-area: 1 / 1;
	}

	.btn__label-stack::before {
		content: attr(data-reserve-1);
		visibility: hidden;
	}

	.btn__label-stack::after {
		content: attr(data-reserve-2);
		visibility: hidden;
	}
`;

export const FORM_CONTROL_STYLES = `
	.form-field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.form-field__label {
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.2;
		color: var(--foreground);
	}

	.form-field:has(.form-input:disabled) .form-field__label {
		color: var(--muted-foreground);
	}

	.form-field__error {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.35;
		color: var(--error-text);
		text-wrap: pretty;
	}

	.form-field__error:empty {
		display: none;
	}

	.form-field__message {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.35;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}

	.form-input {
		height: var(--input-height);
		padding: var(--input-padding);
		border: 1px solid var(--input);
		border-radius: var(--radius);
		background: var(--background);
		color: var(--foreground);
		font-family: inherit;
		font-size: var(--input-font-size);
		transition: border-color 150ms ease, box-shadow 150ms ease;
	}

	.form-input::placeholder,
	.form-input__control::placeholder {
		color: var(--input-placeholder);
		opacity: 1;
	}

	.form-input--multiline {
		height: auto;
		min-height: calc(var(--input-height) * 2.5);
		line-height: 1.5;
		resize: vertical;
	}

	.form-input--within {
		display: flex;
		align-items: stretch;
		height: auto;
		min-height: var(--input-height);
		padding: 0;
	}

	.form-input__control {
		flex: 1 1 auto;
		min-width: 0;
		padding: var(--input-padding);
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: var(--input-font-size);
		color: inherit;
		outline: none;
	}

	.form-input[aria-invalid="true"] {
		border-color: var(--color-error);
	}

	.form-input:focus,
	.form-input--within:has(.form-input__control:focus-within) {
		outline: none;
		border-color: var(--ring);
		box-shadow: 0 0 0 1px var(--ring);
	}

	.form-input--cta-ring:focus {
		border-color: var(--input);
		box-shadow: none;
	}

	.form-input--cta-ring[aria-invalid="true"]:focus {
		border-color: var(--color-error);
	}

	.form-input--cta-ring:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.form-input:disabled {
		background: var(--muted);
		color: var(--muted-foreground);
		cursor: not-allowed;
		opacity: 1;
	}

	.form-choice {
		appearance: none;
		width: 18px;
		height: 18px;
		margin: 0;
		flex: none;
		display: inline-grid;
		place-content: center;
		border: 1.5px solid var(--foreground);
		border-radius: 5px;
		background: transparent;
		cursor: pointer;
	}

	.form-choice[type="radio"] {
		border-radius: 50%;
	}

	.form-choice[type="checkbox"]:checked,
	.form-choice[type="checkbox"]:indeterminate {
		background: var(--foreground);
	}

	.form-choice[type="checkbox"]:checked::before {
		content: "";
		width: 5px;
		height: 9px;
		margin-top: -2px;
		border: solid var(--background);
		border-width: 0 1.5px 1.5px 0;
		transform: rotate(45deg);
	}

	.form-choice[type="checkbox"]:indeterminate::before {
		content: "";
		width: 8px;
		height: 0;
		margin-top: 0;
		border: 0;
		border-bottom: 1.5px solid var(--background);
		transform: none;
	}

	.form-choice[type="radio"]:checked {
		background: radial-gradient(circle, var(--foreground) 0 4px, transparent 4.5px);
	}

	.form-choice:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
`;

export const CHIP_STYLES = `
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		max-width: 100%;
		min-width: 0;
		min-height: 26px;
		padding: 2px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--muted);
		color: var(--foreground);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.chip--badge {
		min-height: 22px;
		padding: 1px 6px;
		white-space: nowrap;
	}

	.chip--large {
		min-height: 34px;
		padding: 4px 12px;
		font-size: var(--text-sm);
	}

	.chip--status {
		min-height: 34px;
		padding: 4px 12px;
		font-weight: 600;
		white-space: nowrap;
	}

	.chip--accent {
		border-color: var(--color-brand);
		background: var(--color-brand-light);
	}

	.chip--badge.chip--accent {
		color: var(--primary-text-on-tint);
	}

	.chip--success {
		border-color: var(--color-success);
		background: var(--success-bg);
		color: var(--success-text);
	}

	.chip--error {
		border-color: var(--color-error);
		background: var(--error-bg);
	}

	.chip__remove-form {
		display: inline-flex;
		margin: 0;
	}

	.chip__remove {
		position: relative;
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 4px;
		margin: -4px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--foreground);
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.chip__remove::before {
		content: "";
		position: absolute;
		inset: -6px -8px -6px -4px;
	}

	.chip__remove:hover {
		background: var(--card);
	}

	.chip__remove:focus-visible {
		background: var(--card);
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	.chip__remove svg {
		width: 16px;
		height: 16px;
	}
`;

export const HEADER_STYLES = `
	.header {
		display: flex;
		align-items: center;
		min-height: 72px;
		background: var(--background);
		border-bottom: 1px solid var(--border);
		padding: 0 var(--header-inset);
		position: sticky;
		top: var(--banner-area-height, 52px);
		z-index: 100;
		transition: transform 0.25s ease;
	}
	/* -100% is exactly the header's height and the changelog banner rises with it. */
	.nav-hidden .header {
		transform: translateY(calc(-100% - var(--changelog-banner-height, 0px)));
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
		top: var(--banner-area-height, 52px);
		left: 0;
		right: 0;
	}
	.header__content {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 16px;
	}
	.header__start {
		display: flex;
		align-items: center;
		min-width: 0;
		flex: 1 1 auto;
	}
	@media (min-width: 768px) {
		.header__start {
			flex: 0 1 auto;
		}
	}
	@media (min-width: 1200px) {
		.header__content {
			display: grid;
			grid-template-columns: 1fr auto 1fr;
		}
		.header__start {
			grid-column: 1;
		}
	}
	.header__brand {
		font-family: var(--font-serif);
		font-size: var(--text-md);
		font-weight: 700;
		color: var(--header-brand-stem);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.header__brand-icon {
		width: 30px;
		height: 30px;
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
		font-size: var(--text-sm);
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
		background: var(--warning-bg);
		color: var(--foreground);
		max-height: 0;
		overflow: hidden;
		transition: max-height 0.3s ease, padding 0.3s ease;
		padding: 0 16px;
	}

	.offline-banner--visible {
		max-height: 120px;
		padding: 14px 16px;
	}
`;

export const NEWER_VERSION_BANNER_STYLES = `
	.newer-version-banner {
		max-height: 0;
		overflow: hidden;
		transition: max-height 0.3s ease, padding 0.3s ease;
		padding-block: 0;
	}

	.newer-version-banner--visible {
		max-height: 320px;
		padding-block: 16px;
	}

	.newer-version-banner__content {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 16px;
		min-height: 32px;
	}

	@media (min-width: 768px) {
		.newer-version-banner__content {
			flex-direction: row;
			align-items: center;
			justify-content: center;
		}

		.newer-version-banner__refresh {
			flex: 0 0 auto;
		}
	}
`;

export const NAV_STYLES = `
	.nav {
		position: relative;
	}

	.nav__toggle {
		position: relative;
		display: block;
		width: 44px;
		height: 44px;
		margin-right: calc((24px - 44px) / 2);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
		color: var(--foreground);
		list-style: none;
	}

	.nav__toggle::-webkit-details-marker {
		display: none;
	}

	.nav__toggle-icon {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: opacity 0.2s ease;
	}

	.nav__toggle-icon svg {
		width: 24px;
		height: 24px;
	}

	.nav__toggle-icon--close {
		opacity: 0;
	}

	.header--transparent .nav__toggle {
		color: var(--color-on-brand);
	}

	.nav__disclosure[open] .nav__toggle-icon--open {
		opacity: 0;
	}

	.nav__disclosure[open] .nav__toggle-icon--close {
		opacity: 1;
	}

	.nav__menu {
		display: block;
		position: fixed;
		top: calc(var(--banner-area-height, 52px) + var(--header-height, 72px));
		right: 0;
		bottom: 0;
		width: min(80vw, 320px);
		background: var(--background);
		border-left: 1px solid var(--border);
		box-shadow: var(--shadow-md);
		z-index: 101;
		padding: 12px 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		transform: translateX(100%);
		visibility: hidden;
		transition: transform 0.25s ease, visibility 0s linear 0.25s;
	}

	.nav__disclosure[open] .nav__menu {
		transform: translateX(0);
		visibility: visible;
		transition: transform 0.25s ease, visibility 0s;
	}

	@media (prefers-reduced-motion: reduce) {
		.nav__menu {
			transition: none;
		}
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
		font-size: var(--text-sm); /* 1 */
	}

	.nav__link {
		display: flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
	}

	.nav__link:not(.btn) {
		width: 100%;
		padding: 12px 16px;
		background: none;
		border: none;
		font: inherit;
		font-weight: 500;
		color: var(--foreground);
		text-align: left;
		cursor: pointer;
	}

	.nav__link:not(.btn):hover {
		background: var(--muted);
	}

	.nav__group--library .nav__link {
		color: var(--ink-nav-inactive);
	}

	.nav__link[aria-current="page"] {
		color: var(--ink-nav-current);
	}

	.nav__icon-wrap {
		flex-shrink: 0;
		display: inline-flex;
		justify-content: center;
		width: 24px;
	}

	.nav__icon {
		flex-shrink: 0;
		display: inline-flex;
	}

	.nav__icon svg {
		width: 24px;
		height: 24px;
	}

	.nav__link.btn .nav__icon-wrap {
		width: 20px;
	}

	.nav__link.btn .nav__icon svg {
		width: 20px;
		height: 20px;
	}

	.nav__user {
		position: relative;
	}

	.nav__user-summary {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		list-style: none;
		cursor: pointer;
		color: var(--foreground);
	}

	.nav__user-summary::-webkit-details-marker {
		display: none;
	}

	.nav__avatar {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--color-avatar);
		color: var(--color-on-brand);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.nav__avatar:empty {
		display: none;
	}

	.nav__user-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.nav__user-chevron {
		flex: 0 0 auto;
		display: inline-flex;
		color: var(--foreground);
		transition: transform 0.15s ease;
	}

	.nav__user-chevron svg {
		width: 24px;
		height: 24px;
	}

	.nav__user[open] .nav__user-chevron {
		transform: rotate(180deg);
	}

	.nav__user-identity {
		display: none;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		color: var(--foreground);
	}

	@media (max-width: 767px) {
		.header {
			overflow-x: clip;
		}
		.nav-hidden .header:has(.nav__disclosure[open]) {
			transform: none;
		}
		.nav__link.btn {
			width: calc(100% - 32px);
			margin: 8px 16px;
		}
		@supports selector(::details-content) {
			.nav__user {
				display: contents;
			}
			.nav__user::details-content {
				content-visibility: visible;
			}
			.nav__user-summary {
				display: none;
			}
			.nav__user-identity {
				display: flex;
			}
		}
	}

	@media (min-width: 768px) {
		.nav__toggle {
			display: none;
		}

		/**
		* 1. A closed <details> hides its content, and the two engines do it
		*    differently — older Chromium/Firefox via a UA display rule on the
		*    non-summary children, current Chromium via content-visibility on
		*    ::details-content. The bar is never rendered at this width, so the
		*    menu has to show whatever the open state happens to be.
		*/
		.nav,
		.nav__disclosure,
		.nav__menu {
			display: contents; /* 1 */
		}

		.nav__menu {
			visibility: visible;
			transform: none;
			transition: none;
		}

		.nav__disclosure::details-content {
			display: contents; /* 1 */
			content-visibility: visible; /* 1 */
		}

		.nav__group {
			display: flex;
			align-items: center;
			padding: 0;
		}

		.nav__link {
			white-space: nowrap;
		}

		.nav__group--account {
			margin-left: auto;
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
		}

		.nav__list {
			display: flex;
			gap: 4px;
		}

		.nav__link:not(.btn) {
			padding: 10px 12px;
			border-radius: var(--radius);
		}

		.nav__user-summary {
			padding: 10px 8px;
			margin-right: -8px;
			border-radius: var(--radius);
		}

		.nav__user-summary:hover {
			background: var(--muted);
		}

		.nav__user-name {
			max-width: 220px;
		}

		.nav__user-menu {
			position: absolute;
			right: 0;
			top: calc(100% + 6px);
			min-width: 120px;
			width: max-content;
			flex-direction: column;
			gap: 1px;
			padding: 0;
			overflow: hidden;
			background: var(--border);
			border: 1px solid var(--border);
			border-radius: var(--radius-md);
			box-shadow: var(--shadow-menu);
			z-index: 102;
		}

		.nav__user-menu > li {
			background: var(--card);
		}

		.nav__user-menu .nav__link {
			min-height: 44px;
			border-radius: 0;
			padding: 0 12px;
			gap: 12px;
			font-size: var(--text-sm);
			font-weight: 500;
		}

		.nav__user-menu .nav__icon-wrap {
			width: 1.25rem;
		}

		.nav__user-menu .nav__icon svg {
			width: 1.25rem;
			height: 1.25rem;
		}

		.nav__user-menu .nav__link,
		.nav__user-menu .nav__icon {
			color: var(--foreground);
		}

		.nav__user-menu .nav__link:focus-visible {
			outline-offset: -2px;
		}

		.header--transparent .nav__link,
		.header--transparent .nav__user-summary {
			color: var(--color-on-brand);
		}

		.header--transparent .nav__link:not(.btn):hover,
		.header--transparent .nav__user-summary:hover {
			background: rgba(255, 255, 255, 0.1);
		}

		.header--transparent .nav__user-menu .nav__link {
			color: var(--foreground);
		}

		.header--transparent .nav__user-menu .nav__link:hover {
			background: var(--muted);
		}
	}

	@media (min-width: 1200px) {
		.nav__group--library {
			grid-column: 2;
			justify-self: center;
		}

		.nav__group--account {
			grid-column: 3;
			justify-self: end;
		}
	}
`;

export const VERIFY_BANNER_STYLES = `
	.verify-banner--visible { display: block; }
	.verify-banner--hidden { display: none; }

	.verify-banner--locked {
		background: var(--error-fill);
		color: var(--error-foreground);
	}

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
		transition: transform 0.25s ease;
	}
	.nav-hidden .banner-area {
		transform: translateY(calc(-1 * var(--changelog-banner-height, 0px)));
	}
	@media (prefers-reduced-motion: reduce) {
		.banner-area {
			transition: none;
		}
	}
`;

export const BANNER_BAR_STYLES = `
	.banner-bar {
		position: relative;
		background: var(--announcement-bg);
		color: var(--color-on-brand);
		font-size: var(--text-md);
		font-weight: 600;
		line-height: 1.5rem;
		text-align: center;
		padding: 14px 72px;
	}

	.banner-bar__close {
		position: absolute;
		top: 50%;
		right: 12px;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-on-brand);
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.banner-bar__close svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	.banner-bar__close:hover,
	.banner-bar__close:focus-visible {
		background: rgba(255, 255, 255, 0.15);
	}

	@media (max-width: 767px) {
		.banner-bar {
			padding-inline: var(--page-gutter);
		}

		.banner-bar:has(.banner-bar__close) {
			padding-right: 72px;
		}
	}
`;

export const DISTRACTION_FREE_STYLES = `
	.${DISTRACTION_FREE_BODY_CLASS} .header,
	.${DISTRACTION_FREE_BODY_CLASS} .changelog-banner,
	.${DISTRACTION_FREE_BODY_CLASS} .verify-banner {
		display: none;
	}
	html:has(> body.${DISTRACTION_FREE_BODY_CLASS}) {
		scroll-padding-top: var(--banner-area-height, 52px);
	}
`;

/**
 * `--banner-area-height` reserves vertical space for the *fixed* `.banner-area`
 * — `body` pads by it so content clears the bar. The chromeless shell has no
 * fixed bar (its announcement rides in normal flow), so nothing needs reserving
 * and the correct height is zero. Without this the fallback strands a dead
 * strip above the announcement, and above the article when there is none.
 */
export const CHROMELESS_BANNER_AREA_STYLES = `
	:root {
		--banner-area-height: 0px;
	}
`;

export const CHANGELOG_BANNER_STYLES = `
	.changelog-banner--visible { display: block; }
	.changelog-banner--hidden { display: none; }

	.changelog-banner__inner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 20px;
	}

	.changelog-banner__hook {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.changelog-banner__link {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--announcement-link);
		text-decoration: none;
		white-space: nowrap;
	}

	.changelog-banner__link svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	.changelog-banner__link:hover,
	.changelog-banner__link:focus-visible {
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 3px;
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
