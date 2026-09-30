import {
	type NewsletterCatalogDocument,
	NewsletterCatalogDocumentSchema,
} from "@packages/domain/newsletter-catalog";
import type { ReadNewsletterCatalog, WriteNewsletterCatalog } from "@packages/provider-contracts/newsletter-catalog";

function stored(document: NewsletterCatalogDocument): NewsletterCatalogDocument {
	return NewsletterCatalogDocumentSchema.parse(JSON.parse(JSON.stringify(document)));
}

export interface InMemoryNewsletterCatalog {
	readCatalog: ReadNewsletterCatalog;
	writeCatalog: WriteNewsletterCatalog;
	failReads: (on: boolean) => void;
	conflictNextWrite: () => void;
	failNextWrite: () => void;
	current: () => NewsletterCatalogDocument | undefined;
}

export function initInMemoryNewsletterCatalog(initial: NewsletterCatalogDocument | undefined): InMemoryNewsletterCatalog {
	let document = initial === undefined ? undefined : stored(initial);
	let etag = initial === undefined ? undefined : "etag-1";
	let version = 1;
	let readsFail = false;
	let nextWrite: "conflict" | "unavailable" | undefined;

	const readCatalog: ReadNewsletterCatalog = async () => {
		if (readsFail) return { ok: false, reason: "unavailable" };
		return { ok: true, document: document ?? { version: 1, records: [] }, etag };
	};

	const writeCatalog: WriteNewsletterCatalog = async (input) => {
		const injected = nextWrite;
		nextWrite = undefined;
		if (injected !== undefined) return { ok: false, reason: injected };
		if (input.expectedEtag !== etag) return { ok: false, reason: "conflict" };
		version += 1;
		document = stored(input.document);
		etag = `etag-${version}`;
		return { ok: true, etag };
	};

	return {
		readCatalog,
		writeCatalog,
		failReads: (on: boolean) => {
			readsFail = on;
		},
		conflictNextWrite: () => {
			nextWrite = "conflict";
		},
		failNextWrite: () => {
			nextWrite = "unavailable";
		},
		current: () => document,
	};
}
