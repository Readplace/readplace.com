import type { UserId } from "@packages/domain/user";

export interface BannerStateSource {
	userId?: UserId;
	emailVerified?: boolean;
}

export interface BannerState {
	isAuthenticated: boolean;
	emailVerified: boolean | undefined;
	/** When true, the SSR markup carries data-show-extension-suggestion="true"
	 * so the banner client can reveal the dismissible extension-suggestion banner
	 * (subject to its own localStorage dismissal). Defaults to false; the queue
	 * and view page handlers set it when the latest article is not fully parsed. */
	showExtensionSuggestionBanner?: boolean;
}

export function bannerStateFromRequest(source: BannerStateSource): BannerState {
	return {
		isAuthenticated: Boolean(source.userId),
		emailVerified: source.emailVerified,
	};
}
