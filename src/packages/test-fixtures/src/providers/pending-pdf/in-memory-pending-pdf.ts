import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { PutPendingPdf, ReadPendingPdf } from "./pending-pdf.types";

export interface InMemoryPendingPdf {
	putPendingPdf: PutPendingPdf;
	readPendingPdfSync: (url: string) => Buffer | undefined;
	readPendingPdf: ReadPendingPdf;
}

export function initInMemoryPendingPdf(): InMemoryPendingPdf {
	const store = new Map<string, Buffer>();

	const keyFor = (url: string) =>
		`pending-pdf/${encodeURIComponent(ArticleResourceUniqueId.parse(url).value)}.pdf`;

	const putPendingPdf: PutPendingPdf = async (params) => {
		store.set(keyFor(params.url), params.bytes);
	};

	const readPendingPdfSync = (url: string): Buffer | undefined => store.get(keyFor(url));

	const readPendingPdf: ReadPendingPdf = async (url) => {
		const bytes = store.get(keyFor(url));
		if (!bytes) throw new Error(`pending-pdf missing for ${url}`);
		return bytes;
	};

	return { putPendingPdf, readPendingPdfSync, readPendingPdf };
}
