import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { initArchiveHealthClient } from "./archive-health-client";
import type { ArchiveHealthReport, UploadHealthReport, initArchiveHealthEvidence } from "./archive-health-evidence";
import type { SaveHealthSource } from "./health-sources";

export function initArchiveHealth(deps: {
	client: ReturnType<typeof initArchiveHealthClient>;
	evidence: ReturnType<typeof initArchiveHealthEvidence>;
	readCompletionMessages: (input: { match: string; startedAt: number }) => Promise<string[]>;
	now: () => number;
	wait: () => Promise<void>;
	timeoutMs: number;
	report: (result: ArchiveHealthReport | UploadHealthReport | { label: string; saveAttemptId: string; originalUrl: string; cardId: string; outcome: "deduplicated" }) => Promise<void>;
}) {
	const cardIds = new Map<string, string>();
	let loggedIn = false;

	return async (source: SaveHealthSource): Promise<void> => {
		if (!loggedIn) {
			await deps.client.login();
			loggedIn = true;
		}
		const startedAt = deps.now();
		if (source.save.kind === "upload") {
			const uploadSource = { ...source, save: source.save };
			await deps.client.upload({ url: source.url, title: source.save.title, html: source.save.html });
			let report: UploadHealthReport | undefined;
			while (deps.now() - startedAt < deps.timeoutMs) {
				const messages = await deps.readCompletionMessages({ match: source.url, startedAt });
				report = deps.evidence.verifyUpload({ source: uploadSource, messages });
				if (report !== undefined) break;
				await deps.wait();
			}
			assert(report, `${source.label}: no completed comparison for the upload of ${source.url}`);
			await deps.report(report);
			return;
		}
		const saveAttemptId = await deps.client.save(source.url);
		if (source.save.kind === "archive") {
			const archiveSource = { ...source, save: source.save };
			let report: ArchiveHealthReport | undefined;
			while (deps.now() - startedAt < deps.timeoutMs) {
				const messages = await deps.readCompletionMessages({ match: saveAttemptId, startedAt });
				try {
					report = await deps.evidence.verify({ source: archiveSource, saveAttemptId, messages });
				} catch (error) {
					throw new Error(`${source.label}: save attempt ${saveAttemptId}: ${String(error)}`, { cause: error });
				}
				if (report !== undefined) break;
				await deps.wait();
			}
			assert(report, `${source.label}: no completed comparison for accepted save attempt ${saveAttemptId}`);
			await deps.report(report);
		}
		let cardId: string | undefined;
		while (deps.now() - startedAt < deps.timeoutMs) {
			cardId = await deps.client.findOnlyCard(source.expectedDestinationUrl);
			if (cardId !== undefined) break;
			await deps.wait();
		}
		assert(cardId, `${source.label}: saved original card never appeared`);
		const originalId = ArticleResourceUniqueId.parse(source.expectedDestinationUrl).value;
		const previousCardId = cardIds.get(originalId);
		if (source.save.kind === "direct") assert(previousCardId, "direct deduplication check requires a preceding archive save");
		if (previousCardId !== undefined) assert.equal(cardId, previousCardId, "archive, calendar and direct saves must keep the same card");
		cardIds.set(originalId, cardId);
		if (source.save.kind === "direct") {
			await deps.report({ label: source.label, saveAttemptId, originalUrl: source.expectedDestinationUrl, cardId, outcome: "deduplicated" });
		}
	};
}
