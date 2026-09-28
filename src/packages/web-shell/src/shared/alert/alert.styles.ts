export const ALERT_STYLES = `
	.alert {
		box-sizing: border-box;
		width: 100%;
		align-items: flex-start;
		gap: 12px;
		padding: 15px;
		border: 1px solid var(--alert-mark);
		border-radius: var(--radius);
		background: var(--alert-tint);
		color: var(--foreground);
		font-family: var(--font-sans);
	}

	.alert--visible { display: flex; }
	.alert--hidden { display: none; }

	.alert--error {
		--alert-mark: var(--color-error);
		--alert-tint: var(--error-bg);
	}

	.alert--warning {
		--alert-mark: var(--color-warning);
		--alert-tint: var(--warning-bg);
		--alert-icon: var(--warning-text);
	}

	.alert--success {
		--alert-mark: var(--color-success);
		--alert-tint: var(--success-bg);
	}

	.alert--info {
		--alert-mark: var(--color-info);
		--alert-tint: var(--info-bg);
	}

	.alert__icon {
		flex: 0 0 24px;
		width: 24px;
		height: 24px;
		color: var(--alert-icon, var(--alert-mark));
	}

	.alert__icon svg {
		display: block;
		width: 24px;
		height: 24px;
	}

	.alert__content {
		align-self: center;
		flex: 1 1 auto;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.alert__title,
	.alert__message {
		margin: 0;
		color: var(--foreground);
		font-size: var(--text-sm);
		line-height: 1.6;
	}

	.alert__title {
		font-family: var(--font-sans);
		font-weight: 600;
		text-wrap: balance;
	}

	.alert__message {
		font-weight: 400;
		text-wrap: pretty;
	}

	.alert__message > :first-child { margin-top: 0; }
	.alert__message > :last-child { margin-bottom: 0; }

	.alert__message a {
		color: inherit;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 3px;
	}

	.alert__message a:hover { text-decoration-thickness: 2px; }
	.alert__message a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}
`;
