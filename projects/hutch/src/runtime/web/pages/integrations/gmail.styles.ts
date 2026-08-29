export const GMAIL_PAGE_STYLES = `
.gmail {
	padding: 60px 24px;
}

@media (min-width: 768px) {
	.gmail {
		padding: 80px 40px;
	}
}

.gmail__container {
	max-width: var(--reader-max-width);
	margin: 0 auto;
}

.gmail__back {
	display: inline-block;
	font-size: 0.875rem;
	color: var(--muted-foreground);
	text-decoration: none;
	margin-bottom: 16px;
}

.gmail__back:hover {
	color: var(--foreground);
	text-decoration: underline;
}

.gmail__title {
	font-family: var(--font-serif);
	font-size: 2rem;
	font-weight: 700;
	text-wrap: balance;
	margin-bottom: 8px;
	color: var(--foreground);
}

.gmail__status {
	display: inline-block;
	font-size: 0.8125rem;
	font-weight: 600;
	padding: 4px 10px;
	border-radius: var(--radius-sm);
	border: 1px solid currentColor;
	margin-bottom: 24px;
}

.gmail__status--awaiting-confirmation,
.gmail__status--disconnected {
	color: var(--muted-foreground);
}

.gmail__status--ready-to-filter,
.gmail__status--filtering {
	color: var(--primary);
}

.gmail__status--revoked,
.gmail__status--filter-failed {
	color: var(--destructive);
}

.gmail__notice,
.gmail__alert {
	padding: 12px 16px;
	border-radius: var(--radius-sm);
	font-size: 0.9375rem;
	line-height: 1.6;
	margin-bottom: 20px;
}

.gmail__notice {
	border: 1px solid var(--border);
	background: var(--muted);
	color: var(--foreground);
}

.gmail__alert {
	border: 1px solid var(--destructive);
	color: var(--destructive);
}

.gmail__notice--hidden,
.gmail__alert--hidden,
.gmail__step--hidden,
.gmail__senders--hidden,
.gmail__reconnect--hidden,
.gmail__unsorted--hidden,
.gmail__item-mapped--hidden {
	display: none;
}

.gmail__notice--visible,
.gmail__alert--visible,
.gmail__unsorted--visible {
	display: block;
}

.gmail__step--visible,
.gmail__senders--visible,
.gmail__reconnect--visible {
	display: block;
}

.gmail__item-mapped--visible {
	display: inline;
}

.gmail__step-title,
.gmail__section-title {
	font-family: var(--font-serif);
	font-size: 1.25rem;
	font-weight: 700;
	margin-bottom: 8px;
	color: var(--foreground);
}

.gmail__step-copy {
	font-size: 0.9375rem;
	line-height: 1.7;
	text-wrap: pretty;
	color: var(--muted-foreground);
	margin-bottom: 16px;
}

.gmail__copy-field {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 16px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--card);
	margin-bottom: 16px;
}

.gmail__copy-field:focus-within {
	outline: 2px solid var(--ring);
	outline-offset: 2px;
}

.gmail__copy-value {
	flex: 1 1 auto;
	font-family: var(--font-mono);
	font-size: 0.9375rem;
	overflow-wrap: anywhere;
	color: var(--foreground);
}

.gmail__copy-button {
	flex: none;
}

.gmail__add {
	display: flex;
	align-items: flex-end;
	flex-wrap: wrap;
	gap: 12px;
	margin-bottom: 20px;
}

.gmail__add-label {
	flex: 1 1 100%;
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--muted-foreground);
}

.gmail__add-input {
	flex: 1 1 240px;
	padding: 10px 14px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--background);
	color: var(--foreground);
	font-size: 0.9375rem;
}

.gmail__list {
	list-style: none;
	padding: 0;
	margin: 0 0 24px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.gmail__item {
	display: flex;
	align-items: center;
	gap: 14px;
	flex-wrap: wrap;
	padding: 16px 20px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--card);
}

.gmail__item-body {
	flex: 1 1 200px;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.gmail__item-name {
	font-size: 0.9375rem;
	font-weight: 600;
	overflow-wrap: anywhere;
	color: var(--foreground);
}

.gmail__item-detail,
.gmail__item-mapped {
	font-size: 0.8125rem;
	overflow-wrap: anywhere;
	color: var(--muted-foreground);
}

.gmail__disconnect {
	margin-top: 24px;
}
`;
