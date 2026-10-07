import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { PutPendingPdf, ReadPendingPdf } from "@packages/provider-contracts/pending-pdf";

export interface InMemoryPendingPdf {
	putPendingPdf: PutPendingPdf;
	readPendingPdfSync: (url: string, options: { saveAttemptId: string }) => Buffer | undefined;
	readPendingPdf: ReadPendingPdf;
}

export function initInMemoryPendingPdf(): InMemoryPendingPdf {
	const store = new Map<string, Buffer>();

	const keyFor = (url: string, options: { saveAttemptId: string }) => ArticleResourceUniqueId.parse(url).toS3PendingPdfKey(options.saveAttemptId);

	const putPendingPdf: PutPendingPdf = async (params) => {
		store.set(keyFor(params.url, params), params.bytes);
	};

	const readPendingPdfSync = (url: string, options: { saveAttemptId: string }): Buffer | undefined => store.get(keyFor(url, options));

	const readPendingPdf: ReadPendingPdf = async (url, options) => {
		const bytes = store.get(keyFor(url, options));
		if (!bytes) throw new Error(`pending-pdf missing for ${url}`);
		return bytes;
	};

	return { putPendingPdf, readPendingPdfSync, readPendingPdf };
}
