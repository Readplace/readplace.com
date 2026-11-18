import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { KNOWN_TIERS } from "@packages/article-state-types";
import { initS3ReadContent, type S3GetObject } from "@packages/article-store";
import type { CandidateId } from "@packages/domain/article";
import { candidateBodyKeys } from "@packages/tier-source";

export type ReadCandidateBody = (params: { url: string; candidateId: CandidateId }) => Promise<string | undefined>;

export function initS3ReadCandidateBody(deps: { send: S3GetObject; bucketName: string }): ReadCandidateBody {
	return async ({ url, candidateId }) => {
		const id = ArticleResourceUniqueId.parse(url);
		for (const tier of KNOWN_TIERS) {
			const { htmlLocation } = candidateBodyKeys({ url, tier, candidateId });
			const readContent = initS3ReadContent({
				send: deps.send,
				readContentLocation: async () => ({ bucket: deps.bucketName, key: htmlLocation }),
			});
			const html = await readContent(id);
			if (html !== undefined) return html;
		}
		return undefined;
	};
}
