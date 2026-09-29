export const UNDERLINE_TABS_STYLES = `.underline-tabs {
	display: flex;
	flex-wrap: wrap;
	border-bottom: 1px solid var(--border);
}

.underline-tabs__tab {
	position: relative;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 24px 16px;
	border-bottom: 2px solid transparent;
	font-size: var(--text-md);
	font-weight: 400;
	line-height: 1.375;
	color: var(--ink-tab-inactive);
	text-decoration: none;
	white-space: nowrap;
	transition: border-color 150ms ease;
}

.underline-tabs--dense .underline-tabs__tab {
	padding-inline: 12px;
}

.underline-tabs__tab::before {
	content: "";
	position: absolute;
	inset: -2px 0;
}

.underline-tabs__label {
	display: grid;
}

.underline-tabs__label > span,
.underline-tabs__label::after {
	grid-area: 1 / 1;
}

.underline-tabs__label::after {
	content: attr(data-widest);
	font-weight: 600;
	visibility: hidden;
}

.underline-tabs__tab:hover {
	border-bottom-color: var(--muted-foreground);
}

.underline-tabs__tab[aria-current="page"] {
	font-weight: 600;
	color: var(--foreground);
	border-bottom-color: var(--foreground);
}

.underline-tabs.htmx-request .underline-tabs__tab[aria-current="page"] {
	font-weight: 400;
	color: var(--ink-tab-inactive);
	border-bottom-color: transparent;
}

.underline-tabs.htmx-request .underline-tabs__tab.htmx-request {
	font-weight: 600;
	color: var(--foreground);
	border-bottom-color: var(--foreground);
}

@media (max-width: 600px) {
	.underline-tabs__tab {
		flex: 1 1 0;
		justify-content: center;
		padding-inline: 12px;
	}
}
`;
