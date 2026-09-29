export const MENU_STYLES = `.menu {
	position: relative;
	flex: 0 0 auto;
}

.menu__toggle {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 36px;
	min-height: 36px;
	list-style: none;
	border-radius: var(--radius-sm);
	cursor: pointer;
	color: var(--foreground);
}

.menu__toggle::-webkit-details-marker {
	display: none;
}

.menu__toggle:focus-visible {
	outline: 2px solid var(--ring);
	outline-offset: 2px;
}

.menu__toggle svg {
	width: 1.5rem;
	height: 1.5rem;
}

.menu__panel {
	position: absolute;
	right: 0;
	top: 100%;
	z-index: 5;
	display: flex;
	flex-direction: column;
	gap: 1px;
	min-width: 120px;
	width: max-content;
	overflow: hidden;
	background: var(--border);
	border: 1px solid var(--border);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-menu);
}

.menu__panel > * {
	background: var(--card);
}

.menu__item {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	min-height: 44px;
	padding: 0 12px;
	border: 0;
	border-radius: 0;
	background: var(--card);
	font: inherit;
	font-size: var(--text-sm);
	font-weight: 500;
	color: var(--foreground);
	text-align: left;
	white-space: nowrap;
	cursor: pointer;
}

.menu__item svg {
	flex: 0 0 auto;
	width: 1.25rem;
	height: 1.25rem;
	color: var(--foreground);
}

.menu__item:hover,
.menu__item:active {
	background: var(--muted);
}

.menu__item:focus-visible {
	outline: 2px solid var(--ring);
	outline-offset: -2px;
}
`;
