import type { ImportSessionPage } from "@packages/domain/import-session";
import type { ComponentError } from "../../shared/component-error.types";
import { withInternalTracking } from "@packages/web-shell";
import { buildImportToggleAllUrl, buildImportToggleUrl, buildImportUrl } from "./import.url";

export type ImportMode = "upload" | "from-url";

export interface ImportTabViewModel {
	readonly key: ImportMode;
	readonly label: string;
	readonly href: string;
	readonly isActive: boolean;
}

export interface ImportAcquireViewModel {
	readonly mode: ImportMode;
	readonly errors?: readonly ComponentError[];
	readonly uploadAction: string;
	readonly fromUrlAction: string;
	readonly tabs: readonly ImportTabViewModel[];
	/** Pre-filled into the from-url input so a deep link like
	 * `/import?url=…` lands ready to auto-submit. Empty unless the
	 * visitor arrived with a `url` query param on the from-url tab. */
	readonly prefillUrl: string;
}

const IMPORT_TABS_SOURCE = "import-tabs";
const IMPORT_ACQUIRE_SOURCE = "import-acquire";
const IMPORT_REVIEW_SOURCE = "import-review";

export function toImportAcquireViewModel(input: {
	mode?: string;
	url?: string;
	errors?: readonly ComponentError[];
}): ImportAcquireViewModel {
	const mode: ImportMode = input.mode === "upload" ? "upload" : "from-url";
	const tabs: readonly ImportTabViewModel[] = [
		{
			key: "from-url",
			label: "Paste a link",
			href: withInternalTracking("/import", { source: IMPORT_TABS_SOURCE, content: "from-url" }),
			isActive: mode === "from-url",
		},
		{
			key: "upload",
			label: "Upload a file",
			href: withInternalTracking("/import?mode=upload", {
				source: IMPORT_TABS_SOURCE,
				content: "upload",
			}),
			isActive: mode === "upload",
		},
	];
	return {
		mode,
		errors: input.errors,
		uploadAction: withInternalTracking("/import", {
			source: IMPORT_ACQUIRE_SOURCE,
			content: "upload-file",
		}),
		fromUrlAction: withInternalTracking("/import/from-url", {
			source: IMPORT_ACQUIRE_SOURCE,
			content: "fetch-links",
		}),
		tabs,
		prefillUrl: mode === "from-url" ? (input.url?.trim() ?? "") : "",
	};
}

export interface ImportRowViewModel {
	readonly index: number;
	readonly url: string;
	readonly checked: boolean;
}

export interface ImportViewModel {
	readonly sessionId: string;
	readonly rows: readonly ImportRowViewModel[];
	readonly totalUrls: number;
	readonly totalFound: number;
	readonly totalSelected: number;
	readonly truncated: boolean;
	readonly currentPage: number;
	readonly totalPages: number;
	readonly prevUrl?: string;
	readonly nextUrl?: string;
	readonly commitUrl: string;
	readonly toggleUrl: string;
	readonly toggleAllUrl: string;
	readonly allSelected: boolean;
	readonly noneSelected: boolean;
	readonly someSelected: boolean;
}

export function toImportViewModel(
	pageResult: ImportSessionPage,
	totalSelected: number,
): ImportViewModel {
	const { session, pageUrls, page, pageSize } = pageResult;
	const totalPages = Math.max(1, Math.ceil(session.totalUrls / pageSize));
	const start = (page - 1) * pageSize;
	const sessionId = session.id;
	const allSelected = totalSelected === session.totalUrls;
	const noneSelected = totalSelected === 0;
	return {
		sessionId,
		rows: pageUrls.map((url, i) => {
			const index = start + i;
			return {
				index,
				url,
				checked: !session.deselected.has(index),
			};
		}),
		totalUrls: session.totalUrls,
		totalFound: session.totalFound,
		totalSelected,
		truncated: session.truncated,
		currentPage: page,
		totalPages,
		prevUrl:
			page > 1
				? withInternalTracking(buildImportUrl(sessionId, page - 1), {
						source: IMPORT_REVIEW_SOURCE,
						content: "prev",
					})
				: undefined,
		nextUrl:
			page < totalPages
				? withInternalTracking(buildImportUrl(sessionId, page + 1), {
						source: IMPORT_REVIEW_SOURCE,
						content: "next",
					})
				: undefined,
		commitUrl: withInternalTracking(`/import/${sessionId}/commit`, {
			source: IMPORT_REVIEW_SOURCE,
			content: "commit",
		}),
		toggleUrl: withInternalTracking(buildImportToggleUrl(sessionId, page), {
			source: IMPORT_REVIEW_SOURCE,
			content: "toggle-link",
		}),
		toggleAllUrl: withInternalTracking(buildImportToggleAllUrl(sessionId, page), {
			source: IMPORT_REVIEW_SOURCE,
			content: "toggle-all",
		}),
		allSelected,
		noneSelected,
		someSelected: !allSelected && !noneSelected,
	};
}
