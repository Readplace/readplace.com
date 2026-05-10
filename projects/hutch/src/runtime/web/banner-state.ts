import type { UserId } from "@packages/domain/user";

export interface BannerStateSource {
	userId?: UserId;
	emailVerified?: boolean;
	query?: Record<string, unknown>;
}

export interface BannerState {
	isAuthenticated: boolean;
	emailVerified: boolean | undefined;
	featureImport: boolean;
}

export function bannerStateFromRequest(source: BannerStateSource): BannerState {
	return {
		isAuthenticated: Boolean(source.userId),
		emailVerified: source.emailVerified,
		featureImport: source.query?.feature === "import",
	};
}
