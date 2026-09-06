export const SUBSCRIBE_PLANS_STYLES = `
.subscribe-plans__grid {
	display: grid;
	grid-template-columns: 1fr;
	gap: 16px;
}

.subscribe-plans__panel {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 24px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--card);
}

.subscribe-plans__panel--featured {
	border-color: var(--ring);
	box-shadow: var(--shadow-md);
}

.subscribe-plans__badge {
	position: absolute;
	top: 0;
	left: 50%;
	transform: translate(-50%, -50%);
	padding: 3px 10px;
	border-radius: var(--radius-sm);
	background: var(--primary);
	color: var(--primary-foreground);
	font-size: 0.6875rem;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	white-space: nowrap;
}

.subscribe-plans__name {
	font-family: var(--font-sans);
	font-size: 1rem;
	font-weight: 600;
	color: var(--foreground);
	text-wrap: balance;
}

.subscribe-plans__price {
	font-size: 2.25rem;
	font-weight: 700;
	line-height: 1.1;
	color: var(--foreground);
}

.subscribe-plans__cadence {
	font-family: var(--font-sans);
	font-size: 0.875rem;
	font-weight: 500;
	color: var(--color-text-secondary);
}

.subscribe-plans__billed {
	margin-bottom: 16px;
	font-size: 0.8125rem;
	line-height: 1.5;
	color: var(--color-text-secondary);
	text-wrap: pretty;
}

.subscribe-plans__form {
	margin: auto 0 0;
}

.subscribe-plans__choose {
	width: 100%;
}

.subscribe-plans__trigger {
	display: none;
}

@supports selector(:popover-open) {
	.subscribe-plans__trigger {
		display: inline-flex;
	}

	.subscribe-plans__fallback {
		display: none;
	}
}

@media (min-width: 768px) {
	.subscribe-plans__grid {
		grid-template-columns: repeat(3, 1fr);
	}
}
`;
