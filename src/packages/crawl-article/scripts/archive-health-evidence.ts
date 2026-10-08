import assert from "node:assert";
import { createHash } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { z } from "zod";
import type { ArchiveSaveHealthSource, UploadHealthSource } from "./health-sources";

const COMPLETION_PREFIX = "[ArchiveSaveAttempt] comparison completed ";
const Candidate = z.object({
	id: z.string().min(1),
	kind: z.enum(["live", "wrapper", "extension"]),
	originalUrl: z.url(),
	sourceUrl: z.url(),
	contentHash: z.string().regex(/^[a-f0-9]{64}$/),
	httpStatus: z.number().int().optional(),
	readable: z.boolean(),
	fresh: z.boolean(),
	evaluationLocation: z.string().min(1).optional(),
});
const Completion = z.object({
	saveAttemptId: z.uuid(),
	url: z.url(),
	candidates: z.array(Candidate),
	selectedCandidateId: z.string().optional(),
	outcome: z.enum(["selected", "retained", "no-readable"]),
	selectionRule: z.string().optional(),
	ownCaptureFailed: z.boolean().optional(),
	liveAttempt: z.object({ outcome: z.enum(["body", "no-body", "deferred"]) }).optional(),
	audit: z.object({
		judgedCandidates: z.array(z.object({ id: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })),
		promptHash: z.string().regex(/^[a-f0-9]{64}$/),
		responseStatus: z.enum(["completed", "rejected"]),
	}).optional(),
});

export type UploadHealthReport = {
	label: string;
	saveAttemptId: string;
	originalUrl: string;
	outcome: "selected" | "retained";
	selectionRule: string | undefined;
	selected: { id: string; kind: "live" | "wrapper" | "extension"; fresh: boolean; contentHash: string };
};

export type ArchiveHealthReport = {
	label: string;
	saveAttemptId: string;
	originalUrl: string;
	captureUrl: string;
	captureHttpStatus: number | undefined;
	captureContentHash: string;
	comparisonPromptHash: string;
	freshArchive: "article-confirmed" | "article-not-confirmed";
	outcome: "selected" | "retained";
	selected: { id: string; kind: "live" | "wrapper" | "extension"; fresh: boolean; contentHash: string };
};

export function initArchiveHealthEvidence(deps: {
	readEvaluation: (location: string) => Promise<string>;
}) {
	const completionsIn = (messages: readonly string[]) => messages.flatMap((message) => {
		const index = message.indexOf(COMPLETION_PREFIX);
		if (index < 0) return [];
		return [Completion.parse(JSON.parse(message.slice(index + COMPLETION_PREFIX.length)))];
	});

	const findCompletion = (input: { messages: readonly string[]; saveAttemptId: string }) => {
		const matching = completionsIn(input.messages).filter((completion) => completion.saveAttemptId === input.saveAttemptId);
		return matching.filter((completion) =>
			completion.candidates.some((candidate) => candidate.kind === "live" && candidate.fresh)
			|| completion.liveAttempt?.outcome === "no-body",
		).at(-1);
	};

	const verify = async (input: {
		source: ArchiveSaveHealthSource;
		saveAttemptId: string;
		messages: readonly string[];
	}): Promise<ArchiveHealthReport | undefined> => {
		const completion = findCompletion(input);
		if (completion === undefined) return undefined;
		const originalId = ArticleResourceUniqueId.parse(input.source.expectedDestinationUrl).value;
		assert.equal(ArticleResourceUniqueId.parse(completion.url).value, originalId, "save attempt completed under the wrong identity");
		for (const candidate of completion.candidates) {
			assert.equal(ArticleResourceUniqueId.parse(candidate.originalUrl).value, originalId, "judge considered a candidate for a different original");
		}
		const wrappers = completion.candidates.filter((candidate) => candidate.kind === "wrapper" && candidate.fresh);
		assert.equal(wrappers.length, 1, "judge must consider this save's current wrapper response, including a CAPTCHA body (the capture fetch or its source verification failed)");
		const wrapper = wrappers[0];
		const audit = completion.audit;
		assert(audit?.responseStatus === "completed", "judge must complete a valid comparison; rejected or invalid responses cannot make fallback health pass");
		assert(audit.judgedCandidates.some((candidate) => candidate.id === wrapper.id && candidate.contentHash === wrapper.contentHash),
			"current wrapper ID and body hash must be present in the actual judge request");
		assert.equal(wrapper.sourceUrl, input.source.save.captureUrl, "save must fetch the requested capture; a calendar save must request the latest capture");
		assert(wrapper.evaluationLocation, "current wrapper must provide its immutable evaluation artifact");
		const evaluation = await deps.readEvaluation(wrapper.evaluationLocation);
		assert.equal(createHash("sha256").update(evaluation).digest("hex"), wrapper.contentHash, "current wrapper artifact must match the body hash considered by the judge");
		const expected = typeof input.source.expectedContent === "string" ? [input.source.expectedContent] : input.source.expectedContent;
		const containsArticle = expected.every((text) => evaluation.includes(text));
		if (input.source.save.requireFreshArchive) {
			assert(wrapper.readable, "fresh Wayback response is not a readable article; retained content cannot make archive health pass");
			assert(containsArticle, "fresh Wayback artifact is missing expected article content");
		}
		assert(completion.outcome !== "no-readable", "judge found no readable article for this canary source");
		const selected = completion.candidates.find((candidate) => candidate.id === completion.selectedCandidateId);
		assert(selected?.readable, "completed save must name the readable candidate actually selected or retained");
		return {
			label: input.source.label,
			saveAttemptId: input.saveAttemptId,
			originalUrl: input.source.expectedDestinationUrl,
			captureUrl: wrapper.sourceUrl,
			captureHttpStatus: wrapper.httpStatus,
			captureContentHash: wrapper.contentHash,
			comparisonPromptHash: audit.promptHash,
			freshArchive: wrapper.readable && containsArticle ? "article-confirmed" : "article-not-confirmed",
			outcome: completion.outcome,
			selected: { id: selected.id, kind: selected.kind, fresh: selected.fresh, contentHash: selected.contentHash },
		};
	};

	const verifyUpload = (input: { source: UploadHealthSource; messages: readonly string[] }): UploadHealthReport | undefined => {
		const originalId = ArticleResourceUniqueId.parse(input.source.expectedDestinationUrl).value;
		const completion = completionsIn(input.messages).filter((candidate) => ArticleResourceUniqueId.parse(candidate.url).value === originalId).at(-1);
		if (completion === undefined) return undefined;
		const captures = completion.candidates.filter((candidate) => candidate.kind === "extension" && candidate.fresh);
		assert.equal(captures.length, 1, "selection must consider exactly this upload's capture");
		const capture = captures[0];
		assert.equal(capture.contentHash, createHash("sha256").update(input.source.save.html).digest("hex"), "the stored capture must be the uploaded bytes");
		assert.equal(completion.ownCaptureFailed, false, "content selection failed the reader's own upload");
		assert(completion.outcome !== "no-readable", "content selection found nothing readable in the reader's own upload");
		assert.equal(completion.selectedCandidateId, capture.id, "the reader's upload must be the content selected");
		return {
			label: input.source.label,
			saveAttemptId: completion.saveAttemptId,
			originalUrl: input.source.expectedDestinationUrl,
			outcome: completion.outcome,
			selectionRule: completion.selectionRule,
			selected: { id: capture.id, kind: capture.kind, fresh: capture.fresh, contentHash: capture.contentHash },
		};
	};

	return { verify, verifyUpload };
}
