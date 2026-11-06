import type { Logger } from "@packages/logger";
import { assert } from "../invariant";
import type { BulkSavePage } from "./reading-list.types";
import type { SirenAction } from "./siren-wire";

function bytesToMb(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function advertisedLimit(
	descriptor: SirenAction | undefined,
	fieldName: string,
	limit: "maxBytes" | "maxItems" | "maxRequestBytes",
): number | undefined {
	return descriptor?.fields?.find((field) => field.name === fieldName)?.[limit];
}

/** Bulk limits enforced by servers that predate limit advertisement: a 20-page
 * manifest cap and a 20 MiB per-page budget. Assumed whenever save-articles
 * advertises no maxItems/maxBytes, so a request never exceeds what an old
 * server accepts (an unsplit window would be refused wholesale). */
export const LEGACY_SERVER_BULK_LIMITS = { maxItems: 20, maxBytes: 20 * 1024 * 1024, maxRequestBytes: 4_718_592 };

export const REQUEST_ENVELOPE_RESERVE_BYTES = 16 * 1024;

type BulkSaveLimits = { maxItems: number; maxBytes: number; requestBudget: number };

export type BulkChunkSummary = {
	saved: number;
	queued: number;
	skipped: number;
	failed: number;
	tooBig: { url: string; mb: number }[];
	skippedUrls: { url: string; code: string; message?: string }[];
	results?: { url: string; outcome: "created" | "merged" | "skipped" | "failed"; code?: string }[];
};

export type BulkSaveSession = {
	limits: BulkSaveLimits;
	sendChunk: (pages: BulkSavePage[]) => Promise<BulkChunkSummary>;
};

export type OpenBulkSaveSession = () => Promise<BulkSaveSession>;

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const view = new Uint8Array(buffer);
	let binaryString = "";
	for (let i = 0; i < view.length; i += 1) {
		const byte = view[i];
		assert(byte !== undefined, "loop index within Uint8Array bounds");
		binaryString += String.fromCharCode(byte);
	}
	return btoa(binaryString);
}

function manifestEntryFor(page: BulkSavePage): { url: string; title?: string; mediaType?: string } {
	const entry: { url: string; title?: string; mediaType?: string } = { url: page.url };
	if (page.title !== undefined) entry.title = page.title;
	if (page.content) entry.mediaType = page.content.mediaType;
	return entry;
}

export function requestFor(pages: BulkSavePage[]): Record<string, string> {
	/** The bound action takes only string fields, so the manifest is JSON and
	 * each captured page's bytes ride along base64-encoded under a
	 * `contentBase64-<index>` field; the understanding rebuilds the multipart
	 * body from them. */
	const fields: Record<string, string> = {
		manifest: JSON.stringify(pages.map(manifestEntryFor)),
	};
	pages.forEach((page, index) => {
		if (page.content) fields[`contentBase64-${index}`] = arrayBufferToBase64(page.content.bytes);
	});
	return fields;
}

/** A page's request cost is its captured bytes plus its manifest entry —
 * a long URL or tab title spends the same budget as content, so a packed
 * request never outgrows the server's parser cap by manifest weight. */
function requestCostOf(page: BulkSavePage): number {
	return (
		(page.content?.bytes.byteLength ?? 0) +
		new TextEncoder().encode(JSON.stringify(manifestEntryFor(page))).length
	);
}

export function packRequests(
	pages: BulkSavePage[],
	limits: { maxItems: number; maxBytes: number },
): BulkSavePage[][] {
	const requests: BulkSavePage[][] = [];
	let current: BulkSavePage[] = [];
	let currentBytes = 0;
	for (const page of pages) {
		const bytes = requestCostOf(page);
		const overCount = current.length > 0 && current.length >= limits.maxItems;
		const overBytes = current.length > 0 && currentBytes + bytes > limits.maxBytes;
		if (overCount || overBytes) {
			requests.push(current);
			current = [];
			currentBytes = 0;
		}
		current.push(page);
		currentBytes += bytes;
	}
	if (current.length > 0) requests.push(current);
	return requests;
}

export function degradeOversizedPages(params: {
	pages: readonly BulkSavePage[];
	limits: BulkSaveLimits;
	logger: Logger;
}): { pages: BulkSavePage[]; tooBig: { url: string; mb: number }[] } {
	const tooBig: { url: string; mb: number }[] = [];
	const pages = params.pages.map((page) => {
		const bytes = page.content?.bytes.byteLength ?? 0;
		let candidate = page;
		if (bytes > params.limits.maxBytes) {
			params.logger.warn(
				`Captured page of ${bytes} bytes exceeds the ${params.limits.maxBytes}-byte bulk upload limit — saving URL-only`,
			);
			tooBig.push({ url: page.url, mb: bytesToMb(bytes) });
			const { content: _content, ...urlOnly } = page;
			candidate = urlOnly;
		} else if (page.content && requestCostOf(page) > params.limits.requestBudget) {
			params.logger.warn(
				`Captured page of ${bytes} bytes plus its manifest entry exceeds the ${params.limits.requestBudget}-byte request budget — saving URL-only`,
			);
			tooBig.push({ url: page.url, mb: bytesToMb(bytes) });
			const { content: _content, ...urlOnly } = page;
			candidate = urlOnly;
		}
		if (requestCostOf(candidate) > params.limits.requestBudget) {
			params.logger.warn(
				`Manifest entry for ${candidate.url} exceeds the ${params.limits.requestBudget}-byte request budget — dropping its title`,
			);
			return { url: candidate.url };
		}
		return candidate;
	});
	return { pages, tooBig };
}
