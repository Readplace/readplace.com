import type { UserId } from "@packages/domain/user";

export interface BannerStateSource {
	userId?: UserId;
	emailVerified?: boolean;
}

export interface BannerState {
	isAuthenticated: boolean;
	emailVerified: boolean | undefined;
}

export function bannerStateFromRequest(source: BannerStateSource): BannerState {
	return {
		isAuthenticated: Boolean(source.userId),
		emailVerified: source.emailVerified,
	};
}
