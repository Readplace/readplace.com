export const INTEGRATIONS_INDEX_STYLES = `
.integrations {
	padding: 60px 24px;
}

@media (min-width: 768px) {
	.integrations {
		padding: 80px 40px;
	}
}

.integrations__container {
	max-width: var(--reader-max-width);
	margin: 0 auto;
}

.integrations__title {
	font-family: var(--font-serif);
	font-size: 2rem;
	font-weight: 700;
	text-wrap: balance;
	margin-bottom: 8px;
	color: var(--foreground);
}

.integrations__lead {
	font-size: 1.0625rem;
	line-height: 1.7;
	text-wrap: pretty;
	color: var(--muted-foreground);
	margin-bottom: 28px;
}

.integrations__list {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.integrations__item {
	display: flex;
	align-items: center;
	gap: 14px;
	flex-wrap: wrap;
	padding: 16px 20px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--card);
}

.integrations__icon {
	display: inline-flex;
	flex: none;
	color: var(--muted-foreground);
}

.integrations__body {
	display: flex;
	flex-direction: column;
	gap: 2px;
	flex: 1 1 200px;
	min-width: 0;
}

.integrations__name {
	font-size: 1rem;
	font-weight: 600;
	color: var(--foreground);
}

.integrations__description {
	font-size: 0.9375rem;
	line-height: 1.6;
	text-wrap: pretty;
	color: var(--muted-foreground);
}

.integrations__status {
	flex: none;
	font-size: 0.8125rem;
	font-weight: 500;
	border: 1px solid currentColor;
	border-radius: var(--radius-sm);
	padding: 2px 8px;
	white-space: nowrap;
}

.integrations__status--not-set-up {
	color: var(--muted-foreground);
}

.integrations__status--connected {
	color: var(--success-text);
}

.integrations__connect--visible {
	display: block;
	flex: none;
}

.integrations__connect--hidden {
	display: none;
}

.integrations__notice,
.integrations__alert {
	border-radius: var(--radius-sm);
	padding: 12px 16px;
	margin-bottom: 16px;
	font-size: 0.9375rem;
	line-height: 1.6;
	text-wrap: pretty;
}

.integrations__notice {
	border: 1px solid var(--success-text);
	color: var(--success-text);
}

.integrations__alert {
	border: 1px solid var(--error-text);
	color: var(--error-text);
}

.integrations__notice--visible,
.integrations__alert--visible {
	display: block;
}

.integrations__notice--hidden,
.integrations__alert--hidden {
	display: none;
}
`;
