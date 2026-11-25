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
 */
.confirm-popover {
	display: none; /* 1 */
	position: fixed;
	inset: 0;
	margin: auto; /* 2 */
	width: min(600px, calc(100% - 32px));
	height: fit-content;
	max-height: calc(100% - 32px);
	padding: 0;
	border: 1px solid var(--border);
	border-radius: var(--radius-lg);
	background: var(--card);
	color: var(--card-foreground);
	overflow: auto;
	overscroll-behavior: contain;
}

.confirm-popover__surface {
	position: relative;
	/* Paint the panel's contents together, above the backdrop dismiss button. */
	isolation: isolate;
	padding: 24px;
	container-type: inline-size;
}

@supports selector(:popover-open) {
	.confirm-popover:popover-open {
		display: block;
	}
}

.confirm-popover--beside-passage {
	inset: auto 0 16px 0;
	margin: 0 auto;
	max-height: 50dvh;
	box-shadow: var(--shadow-menu);
}

:root:has(.confirm-popover--beside-passage:popover-open) {
	padding-bottom: var(--confirm-popover-sheet-space, 50dvh);
	scroll-padding-bottom: var(--confirm-popover-sheet-space, 50dvh);
}

.confirm-popover--illustrated {
	text-align: center;
}

.confirm-popover__illustration {
	display: flex;
	justify-content: center;
	margin: 0 0 20px;
	color: var(--foreground);
}

.confirm-popover__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 4px;
}

.confirm-popover__header:has(.confirm-popover__close) {
	padding-inline-end: 52px;
}

.confirm-popover--illustrated .confirm-popover__header:has(.confirm-popover__close) {
	padding-inline: 52px;
}

/* A modal's title line is UI, so it stays on the body sans even though it is
 * an h2. Declared, not inherited, so a later h2
 * rule cannot silently flip it to the serif stack. */
.confirm-popover__title {
	font-family: var(--font-sans);
	font-size: var(--text-lg);
	font-weight: 600;
	line-height: 28px;
	color: var(--foreground);
	text-wrap: balance;
}

.confirm-popover__subheading {
	margin: 18px 0 4px;
	font-family: var(--font-sans);
	font-size: var(--text-lg);
	font-weight: 600;
	line-height: 28px;
	color: var(--foreground);
	text-wrap: balance;
}

.confirm-popover__close {
	position: absolute;
	top: 14px;
	right: 14px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 44px;
	min-height: 44px;
	margin: 0;
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
	width: 1.5rem;
	height: 1.5rem;
}

.confirm-popover--illustrated .confirm-popover__header {
	justify-content: center;
}

.confirm-popover__body {
	margin-bottom: 24px;
	font-size: var(--text-sm);
	line-height: 22px;
	color: var(--muted-foreground);
	text-wrap: pretty;
}

.confirm-popover--illustrated .confirm-popover__body {
	max-width: 408px;
	margin-inline: auto;
}

.confirm-popover__body:empty {
	display: none;
}

.confirm-popover__items {
	margin: 0 0 24px;
	padding: 0;
	list-style: none;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	font-size: var(--text-sm);
	font-weight: 500;
	line-height: 22px;
	text-align: left;
}

.confirm-popover__item {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 56px;
	padding: 16px;
	overflow-wrap: anywhere;
	text-wrap: pretty;
}

.confirm-popover__item svg {
	flex: none;
	width: 24px;
	height: 24px;
	color: var(--foreground);
}

.confirm-popover__item + .confirm-popover__item {
	border-top: 1px solid var(--border);
}

.confirm-popover__actions {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.confirm-popover__buttons {
	display: flex;
	flex-direction: row;
	flex-wrap: wrap-reverse;
	justify-content: flex-end;
	gap: 8px;
}

.confirm-popover__buttons .btn {
	padding-inline: 24px;
}

.confirm-popover--illustrated .confirm-popover__buttons {
	justify-content: center;
}

/** 5. The 600px panel leaves 534px after its border and desktop padding; narrower panels stack action buttons so their labels fit. */
@container (max-width: 533px) {
	.confirm-popover__buttons {
		flex-direction: column-reverse;
		flex-wrap: nowrap;
		align-items: stretch;
	}
}

.confirm-popover__buttons--full-width {
	flex-direction: column-reverse;
	flex-wrap: nowrap;
	align-items: stretch;
}

@supports selector(:popover-open) {
	.confirm-popover:popover-open:has(> .confirm-popover__surface > .confirm-popover__items),
	.confirm-popover__surface:has(> .confirm-popover__items) {
		display: flex;
		flex-direction: column;
	}
}

.confirm-popover__surface:has(> .confirm-popover__items) {
	min-height: 0;
}

.confirm-popover__surface:has(> .confirm-popover__items) > * {
	flex: none;
}

.confirm-popover__surface > .confirm-popover__items {
	flex: 1 1 auto;
	min-height: 44px;
	overflow-y: auto;
	overscroll-behavior: contain;
}

@media (min-width: 768px) {
	.confirm-popover__surface {
		padding: 32px;
	}

	.confirm-popover__close {
		top: 22px;
		right: 22px;
	}
}

.confirm-popover--in-flow {
	display: block;
	position: relative;
	inset: auto;
	width: auto;
	height: auto;
	max-height: none;
	margin: 0;
	overflow: visible;
}

@supports selector(:popover-open) {
	@media (scripting: enabled) {
		.confirm-popover--in-flow {
			display: none;
		}
	}

	.confirm-popover--in-flow:popover-open {
		display: block;
		position: fixed;
		inset: 0;
		width: min(600px, calc(100% - 32px));
		height: fit-content;
		max-height: calc(100% - 32px);
		margin: auto;
		overflow: auto;
	}
}
`;
