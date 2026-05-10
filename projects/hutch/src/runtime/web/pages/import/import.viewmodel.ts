import type { ImportSessionPage } from "@packages/domain/import-session";
import { buildImportUrl } from "./import.url";

export interface ImportUploadViewModel {
	readonly errorMessage?: string;
	readonly uploadAction: string;
}

export function toImportUploadViewModel(input: { errorMessage?: string }): ImportUploadViewModel {
	return {
		errorMessage: input.errorMessage,
		uploadAction: "/import?feature=import",
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
	readonly totalFoundInFile: number;
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
		totalFoundInFile: session.totalFoundInFile,
		totalSelected,
		truncated: session.truncated,
		currentPage: page,
		totalPages,
		prevUrl: page > 1 ? buildImportUrl(sessionId, page - 1) : undefined,
		nextUrl: page < totalPages ? buildImportUrl(sessionId, page + 1) : undefined,
		commitUrl: `/import/${sessionId}/commit`,
		toggleUrl: `/import/${sessionId}/toggle`,
		toggleAllUrl: `/import/${sessionId}/toggle-all`,
		allSelected,
		noneSelected,
		someSelected: !allSelected && !noneSelected,
	};
}
