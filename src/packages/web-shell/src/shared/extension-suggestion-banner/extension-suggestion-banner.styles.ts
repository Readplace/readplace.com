export const EXTENSION_SUGGESTION_BANNER_STYLES = `
	.extension-suggestion-banner {
		max-height: 0;
		overflow: hidden;
		transition: max-height 0.3s ease, padding 0.3s ease;
		padding-block: 0;
	}

	.extension-suggestion-banner--visible {
		max-height: 320px;
		padding-block: 16px;
		animation: extension-suggestion-banner-slide-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes extension-suggestion-banner-slide-in {
		from {
			transform: translateY(-100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.extension-suggestion-banner--visible {
			animation: none;
		}
	}

	.extension-suggestion-banner__content {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 16px;
		min-height: 32px;
	}

	@media (min-width: 768px) {
		.extension-suggestion-banner__content {
			flex-direction: row;
			align-items: center;
			justify-content: center;
		}

		.extension-suggestion-banner__cta {
			flex: 0 0 auto;
		}
	}
`;
