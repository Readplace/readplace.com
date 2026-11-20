import {
	type GeneratedContentAccess,
	generatedContentAccessFor,
	parseStorefrontCountryCode,
} from "@packages/domain/article";
import { viewerOf } from "@packages/viewer-identity";
import type { Request } from "express";

export const STOREFRONT_HEADER = "x-readplace-storefront";
export const STOREFRONT_COOKIE_NAME = "readplace_storefront";

export function generatedContentOf(req: Request): GeneratedContentAccess {
	return generatedContentAccessFor({
		viewerCountry: viewerOf(req).location?.country,
		storefront:
			parseStorefrontCountryCode(req.get(STOREFRONT_HEADER)) ??
			parseStorefrontCountryCode(req.cookies[STOREFRONT_COOKIE_NAME]),
	});
}
