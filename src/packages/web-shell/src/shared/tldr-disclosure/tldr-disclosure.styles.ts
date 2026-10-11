export const TLDR_DISCLOSURE_STYLES = `
	.tldr-disclosure {
		background: var(--muted);
		border-radius: var(--radius);
		border: 1px solid var(--border);
	}

	.tldr-disclosure__toggle {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 12px;
		row-gap: 14px;
		cursor: pointer;
		padding: 15px 16px;
		list-style: none;
		user-select: none;
		border-radius: calc(var(--radius) - 1px);
	}

	.tldr-disclosure__heading {
		grid-column: 1;
		grid-row: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 24px;
		font-family: var(--font-sans);
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.5;
		color: var(--foreground);
	}

	.tldr-disclosure__icon {
		display: inline-flex;
		flex: none;
		font-size: 24px;
		margin-inline-start: -2px;
		color: var(--color-brand);
	}

	.tldr-disclosure[open] .tldr-disclosure__toggle {
		padding-bottom: 0;
	}

	.tldr-disclosure__toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.tldr-disclosure__toggle::-webkit-details-marker {
		display: none;
	}

	.tldr-disclosure__caret {
		grid-column: 2;
		grid-row: 1;
		display: flex;
		color: var(--foreground);
		transition: transform 0.15s ease;
	}

	.tldr-disclosure__caret svg {
		width: 1.5rem;
		height: 1.5rem;
	}

	.tldr-disclosure[open] .tldr-disclosure__caret {
		transform: rotate(180deg);
	}

	.tldr-disclosure__preview {
		grid-column: 1 / -1;
		grid-row: 2;
		font-family: var(--font-sans);
		font-size: var(--text-md);
		font-weight: 400;
		line-height: 1.5;
		color: var(--foreground);
		overflow-wrap: anywhere;
		text-wrap: pretty;
	}

	.tldr-disclosure[open] .tldr-disclosure__preview {
		display: none;
	}

	.tldr-disclosure__text {
		font-family: var(--font-sans);
		font-size: 1rem;
		line-height: 1.5;
		white-space: pre-wrap;
		color: var(--foreground);
		overflow-wrap: anywhere;
		text-wrap: pretty;
		margin: 0;
		padding: 14px 16px 15px;
	}

	.tldr-disclosure__body {
		font-family: var(--font-sans);
		font-size: 1rem;
		line-height: 1.5;
		color: var(--foreground);
		overflow-wrap: anywhere;
		text-wrap: pretty;
		margin: 0;
		padding: 14px 16px 15px;
	}

	.tldr-disclosure__body a {
		color: inherit;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 3px;
	}

	@media (prefers-reduced-motion: reduce) {
		.tldr-disclosure__caret {
			transition: none;
		}
	}
`;
