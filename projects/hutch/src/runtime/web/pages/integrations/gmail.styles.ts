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
	font-weight: 500;
	padding: 2px 8px;
	border-radius: var(--radius-sm);
	border: 1px solid currentColor;
	white-space: nowrap;
	margin-bottom: 24px;
}

.gmail__status--awaiting-confirmation {
	color: var(--muted-foreground);
}

.gmail__status--ready-to-filter,
.gmail__status--filtering {
	color: var(--success-text);
}

.gmail__status--revoked,
.gmail__status--filter-failed {
	color: var(--error-text);
}

.gmail__notice,
.gmail__alert {
	padding: 12px 16px;
	border-radius: var(--radius-sm);
	font-size: 0.9375rem;
	line-height: 1.6;
	text-wrap: pretty;
	margin-bottom: 24px;
}

.gmail__notice {
	border: 1px solid var(--border);
	background: var(--muted);
	color: var(--foreground);
}

.gmail__alert {
	border: 1px solid var(--error-text);
	color: var(--error-text);
}

.gmail__step-title,
.gmail__section-title {
	font-family: var(--font-serif);
	font-size: 1.25rem;
	font-weight: 700;
	text-wrap: balance;
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
	background: var(--muted);
	margin-bottom: 16px;
}

.gmail__copy-value {
	flex: 1 1 auto;
	min-width: 0;
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	font-size: 0.9375rem;
	overflow-wrap: anywhere;
	color: var(--foreground);
}

.gmail__copy-button {
	flex: none;
}

.gmail__copy-button[hidden] {
	display: none;
}

.gmail__step-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
}

.gmail__poll {
	font-size: 0.8125rem;
	line-height: 1.6;
	text-wrap: pretty;
	color: var(--muted-foreground);
	margin-top: 16px;
}

.gmail__add {
	margin-bottom: 24px;
}

.gmail__add-label {
	display: block;
	font-size: 0.875rem;
	font-weight: 600;
	color: var(--foreground);
	margin: 0 0 8px;
}

.gmail__add-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.gmail__add-input {
	flex: 1 1 200px;
	min-width: 0;
	height: var(--input-height);
	padding: var(--input-padding);
	font-size: var(--input-font-size);
	color: var(--foreground);
	background: var(--background);
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
}

.gmail__add-input:focus {
	outline: none;
	border-color: var(--ring);
	box-shadow: 0 0 0 3px var(--ring-shadow);
}

.gmail__empty {
	font-size: 0.9375rem;
	line-height: 1.6;
	text-wrap: pretty;
	color: var(--muted-foreground);
	margin: 0 0 24px;
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
	margin-top: 32px;
	padding-top: 24px;
	border-top: 1px solid var(--border);
}

.gmail__disconnect-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-height: 44px;
	cursor: pointer;
	border: 0;
	font-family: inherit;
	padding: var(--button-padding);
	font-size: 0.9375rem;
	font-weight: 600;
	border-radius: var(--radius-sm);
	background: var(--error-fill);
	color: var(--error-foreground);
	transition: background-color 0.15s ease;
}

.gmail__disconnect-button:hover,
.gmail__disconnect-button:active {
	background: var(--error-fill-hover);
}
`;
