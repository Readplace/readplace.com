import { LIGHT_ONLY_BODY_CLASS } from "../../base.styles";

export const CONFIRM_POPOVER_STYLES = `
/**
 * Confirmation panel — native popover.
 *
 * 1. Legacy-first. Whatever the panel confirms stays reachable without it, and
 *    the popover is the enhancement, so the only probe needed is the positive
 *    one. An engine that cannot parse \`selector()\` evaluates the condition as
 *    unknown, and \`not unknown\` is not \`true\` — a
 *    \`@supports not selector(:popover-open)\` fallback would be skipped in
 *    exactly the engines it exists for, leaving the panel stranded open.
 * 2. Restores the centring that BASE_RESET_STYLES' \`* { margin: 0 }\` takes
 *    away: that reset is author-origin, so it beats the UA's
 *    \`[popover] { margin: auto }\` at any specificity. Without this line the
 *    panel pins to the top-left — and stays visible and clickable, so no
 *    test catches it.
 * 3. No var() inside ::backdrop. It has no parent element, and custom
 *    property inheritance into it shipped later than popover support in
 *    every engine (Chrome 122 vs Chrome 114). Where it does not inherit,
 *    var() is the guaranteed-invalid value, the declaration is dropped, and
 *    the page silently ships no scrim. The literals are the brand neutrals
 *    --color-text-primary (light) and --footer-bg (dark).
 * 4. pointer-events is left at the UA default. \`::backdrop\` carries
 *    \`pointer-events: none !important\` in the UA origin, which no author
 *    declaration can beat; making the scrim hit-testable is impossible,
 *    not merely undesirable.
 */
.confirm-popover {
	display: none; /* 1 */
	position: fixed;
	inset: 0;
	margin: auto; /* 2 */
	width: min(400px, calc(100% - 32px));
	height: fit-content;
	max-height: calc(100% - 32px);
	padding: 24px;
	border: 1px solid var(--border);
	border-radius: var(--radius-lg);
	background: var(--card);
	color: var(--card-foreground);
	box-shadow: var(--shadow-md);
	overflow: auto;
	overscroll-behavior: contain;
}

@supports selector(:popover-open) {
	.confirm-popover:popover-open {
		display: block;
	}
}

/* Focus opens on the panel itself (autofocus + tabindex="-1"); the global
 * ring in BASE_RESET_STYLES covers only \`button\` and \`a\`. */
.confirm-popover:focus-visible {
	outline: 2px solid var(--ring);
	outline-offset: 2px;
}

.confirm-popover::backdrop {
	background: rgb(26 32 44 / 0.55); /* 3, 4 */
}

@media (prefers-color-scheme: dark) {
	body:not(.${LIGHT_ONLY_BODY_CLASS}) .confirm-popover::backdrop {
		background: rgb(13 13 13 / 0.72); /* 3 */
	}
}

.confirm-popover__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 8px;
}

/* A modal's title line is UI, so it stays on the body sans even though it is
 * an h2 (BRAND_GUIDELINES.md:152). Declared, not inherited, so a later h2
 * rule cannot silently flip it to the serif stack. */
.confirm-popover__title {
	font-family: var(--font-sans);
	font-size: 1.0625rem;
	font-weight: 700;
	line-height: 1.3;
	color: var(--foreground);
	text-wrap: balance;
}

/* Icon tier padding (--button-padding-xs) with the card's own 44px touch
 * floor; the negative margin pulls the oversized hit box back so the glyph
 * sits on the panel's padding edge. */
.confirm-popover__close {
	flex: 0 0 auto;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 44px;
	min-height: 44px;
	margin: -12px -12px 0 0;
	padding: var(--button-padding-xs);
	border: none;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--muted-foreground);
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease;
}

.confirm-popover__close:hover {
	background: var(--muted);
	color: var(--foreground);
}

.confirm-popover__close svg {
	width: 1rem;
	height: 1rem;
}

.confirm-popover__lead {
	margin-bottom: 16px;
	font-size: 0.9375rem;
	line-height: 1.5;
	color: var(--muted-foreground);
	text-wrap: pretty;
}

.confirm-popover__body {
	margin-bottom: 24px;
	font-size: 0.9375rem;
	line-height: 1.5;
	text-wrap: pretty;
}

.confirm-popover__body--above-list {
	margin-bottom: 8px;
}

.confirm-popover__items {
	margin: 0 0 24px;
	padding-left: 20px;
	list-style: disc;
	font-size: 0.9375rem;
	line-height: 1.5;
}

.confirm-popover__item {
	text-wrap: pretty;
}

.confirm-popover__actions {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

@media (min-width: 768px) {
	.confirm-popover {
		padding: 32px;
	}
}
`;
