import type { ImportSessionPage } from "@packages/domain/import-session";
import type { ComponentError } from "../../shared/component-error.types";
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
	readonly isUpload: boolean;
	readonly isFromUrl: boolean;
	readonly showFromUrl: boolean;
	readonly errors?: readonly ComponentError[];
	readonly uploadAction: string;
	readonly fromUrlAction: string;
	readonly tabs: readonly ImportTabViewModel[];
}

export function toImportAcquireViewModel(input: {
	mode?: string;
	errors?: readonly ComponentError[];
	showFromUrl?: boolean;
}): ImportAcquireViewModel {
	const showFromUrl = input.showFromUrl ?? false;
	const mode: ImportMode = input.mode === "from-url" && showFromUrl ? "from-url" : "upload";
	const featureParam = showFromUrl ? "?feature=import-link-public" : "";
	const tabs: readonly ImportTabViewModel[] = showFromUrl
		? [
				{ key: "upload", label: "Upload a file", href: `/import${featureParam}`, isActive: mode === "upload" },
				{ key: "from-url", label: "Paste a link", href: "/import?mode=from-url&feature=import-link-public", isActive: mode === "from-url" },
			]
		: [];
	return {
		mode,
		isUpload: mode === "upload",
		isFromUrl: mode === "from-url",
		showFromUrl,
		errors: input.errors,
		uploadAction: "/import",
		fromUrlAction: "/import/from-url",
		tabs,
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
		prevUrl: page > 1 ? buildImportUrl(sessionId, page - 1) : undefined,
		nextUrl: page < totalPages ? buildImportUrl(sessionId, page + 1) : undefined,
		commitUrl: `/import/${sessionId}/commit`,
		toggleUrl: buildImportToggleUrl(sessionId, page),
		toggleAllUrl: buildImportToggleAllUrl(sessionId, page),
		allSelected,
		noneSelected,
		someSelected: !allSelected && !noneSelected,
	};
}
