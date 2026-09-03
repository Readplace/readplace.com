import type { Request } from "express";
import { renderExtensionSuggestionBannerOob } from "@packages/web-shell";
import { canOfferExtensionInstall, isExtensionInstalled } from "../../onboarding/extension-install";
import type { ReaderViewFailedOob } from "./article-reader.types";

export const NO_READER_VIEW_FAILED_OOB: ReaderViewFailedOob = () => "";

export function extensionSuggestionBannerOob(req: Request): ReaderViewFailedOob {
	if (!canOfferExtensionInstall(req)) {
		return NO_READER_VIEW_FAILED_OOB;
	}
	return () =>
		renderExtensionSuggestionBannerOob({
			show: true,
			extensionInstalled: isExtensionInstalled(req),
		});
}
