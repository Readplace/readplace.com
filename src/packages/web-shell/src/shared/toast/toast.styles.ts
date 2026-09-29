export const TOAST_STYLES = `.toast {
	position: fixed;
	left: var(--page-gutter);
	right: var(--page-gutter);
	bottom: var(--page-gutter);
	z-index: 300;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 16px;
	border: 1px solid var(--success);
	border-radius: var(--radius);
	background: var(--success-bg);
	color: var(--foreground);
	box-shadow: var(--shadow-toast);
	font-size: var(--text-sm);
	line-height: 1.5;
	transition: opacity 300ms ease, transform 300ms ease;
}

.toast:has(.toast__action-form) {
	padding-block: 8px;
	padding-inline-end: 8px;
}

.toast:focus-visible {
	outline: 2px solid var(--ring);
	outline-offset: 2px;
}

@media (min-width: 768px) {
	.toast {
		left: auto;
		right: var(--header-inset);
		bottom: var(--header-inset);
		max-width: 440px;
	}
}

/* Added by the global toast script just before removal so the toast fades out
	instead of vanishing. */
.toast--dismissing {
	opacity: 0;
	transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
	.toast--dismissing {
		transform: none;
	}
}

.toast__icon {
	display: flex;
	flex: none;
	color: var(--success);
}

.toast__icon svg {
	width: 1.5rem;
	height: 1.5rem;
}

.toast__message {
	flex: 1 1 auto;
	min-width: 0;
	font-weight: 600;
	overflow-wrap: anywhere;
}

.toast__action-form {
	display: flex;
	flex: none;
	margin: 0;
}

.toast__action {
	position: relative;
	white-space: nowrap;
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
