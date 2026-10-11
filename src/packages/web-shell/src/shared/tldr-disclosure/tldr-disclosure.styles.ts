export const TLDR_DISCLOSURE_STYLES = `
	.tldr-disclosure {
		background: var(--card);
		border-radius: var(--radius-lg);
		border: 1px solid var(--border);
	}

	.tldr-disclosure__toggle {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 1rem;
		row-gap: 0.5rem;
		cursor: pointer;
		padding: 1.25rem 1.5rem;
		list-style: none;
		user-select: none;
		border-radius: calc(var(--radius-lg) - 1px);
		transition: background-color 0.15s ease;
	}

	.tldr-disclosure__heading {
		grid-column: 1;
		grid-row: 1;
		font-family: var(--font-sans);
		font-size: 1rem;
		font-weight: 600;
		color: var(--foreground);
	}

	.tldr-disclosure[open] .tldr-disclosure__toggle {
		border-radius: calc(var(--radius-lg) - 1px) calc(var(--radius-lg) - 1px) 0 0;
	}

	.tldr-disclosure__toggle:hover,
	.tldr-disclosure__toggle:active {
		background: var(--muted);
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
		color: var(--muted-foreground);
		transition: transform 0.15s ease;
	}

	.tldr-disclosure__caret svg {
		width: 1rem;
		height: 1rem;
	}

	.tldr-disclosure[open] .tldr-disclosure__caret {
		transform: rotate(180deg);
	}

	.tldr-disclosure__preview {
		grid-column: 1 / -1;
		grid-row: 2;
		font-size: 0.875rem;
		font-weight: 400;
		line-height: 1.5;
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
		text-wrap: pretty;
	}

	.tldr-disclosure[open] .tldr-disclosure__preview {
		display: none;
	}

	.tldr-disclosure__more {
		color: var(--foreground);
		font-weight: 600;
		white-space: nowrap;
	}

	.tldr-disclosure__text {
		font-family: inherit;
		font-size: 1rem;
		line-height: 1.6;
		white-space: pre-wrap;
		color: var(--foreground);
		overflow-wrap: anywhere;
		text-wrap: pretty;
		margin: 0;
		padding: 0 1.5rem 1.25rem;
	}

	.tldr-disclosure__body {
		font-family: inherit;
		font-size: 1rem;
		line-height: 1.6;
		color: var(--foreground);
		overflow-wrap: anywhere;
		text-wrap: pretty;
		margin: 0;
		padding: 0 1.5rem 1.25rem;
	}

	.tldr-disclosure__body a {
		color: inherit;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 3px;
	}

	@media (prefers-reduced-motion: reduce) {
		.tldr-disclosure__toggle,
		.tldr-disclosure__caret {
			transition: none;
		}
	}
`;
