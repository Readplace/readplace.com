export const PAGINATION_STYLES = `.pagination {
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px 24px;
	padding: 0;
}

.pagination--visible {
	display: flex;
}

.pagination--hidden {
	display: none;
}

.pagination__info {
	font-size: var(--text-md);
	font-weight: 500;
	font-variant-numeric: tabular-nums;
	color: var(--ink-pagination);
}

.pagination__info strong {
	font-weight: 600;
	color: var(--foreground);
}

.pagination__controls {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-inline-start: auto;
}

.pagination__link {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	min-height: 36px;
	padding: 6px 8px;
	border-radius: var(--radius);
	font-size: var(--text-md);
	font-weight: 400;
	color: var(--ink-pagination);
	text-decoration: none;
	transition: background-color 150ms ease, color 150ms ease;
}

.pagination__link svg {
	width: 1em;
	height: 1em;
}

.pagination__link--enabled svg {
	color: var(--foreground);
}

.pagination__link--enabled:hover {
	background: var(--card);
	color: var(--foreground);
}

.pagination__link--disabled {
	color: var(--muted-foreground);
	pointer-events: none;
}

.pagination__pages {
	display: flex;
	align-items: center;
	gap: 4px;
	list-style: none;
	margin: 0;
	padding: 0;
}

.pagination__page-item {
	display: flex;
}

.pagination__page {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 36px;
	min-height: 36px;
	padding: 0 8px;
	border: 1px solid transparent;
	border-radius: var(--radius);
	font-size: var(--text-md);
	font-weight: 500;
	color: var(--ink-pagination);
	text-decoration: none;
	transition: background-color 150ms ease, color 150ms ease;
}

a.pagination__page:hover {
	background: var(--card);
	color: var(--foreground);
}

.pagination__page--current {
	background: var(--card);
	border-color: var(--border);
	font-weight: 600;
	color: var(--foreground);
}

.pagination__gap {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 24px;
	color: var(--ink-pagination);
}

.pagination__gap svg {
	width: 1em;
	height: 1em;
}

@media (max-width: 600px) {
	.pagination__info {
		flex-basis: 100%;
	}
}
`;
