import assert from "node:assert";
import { createHash } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { z } from "zod";
import type { ArchiveSaveHealthSource } from "./health-sources";

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
	liveAttempt: z.object({ outcome: z.enum(["body", "no-body", "deferred"]) }).optional(),
	audit: z.object({
		judgedCandidates: z.array(z.object({ id: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })),
		promptHash: z.string().regex(/^[a-f0-9]{64}$/),
		responseStatus: z.enum(["completed", "rejected"]),
	}),
});

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
	const findCompletion = (input: { messages: readonly string[]; saveAttemptId: string }) => {
		const matching = input.messages.flatMap((message) => {
			const index = message.indexOf(COMPLETION_PREFIX);
			if (index < 0) return [];
			const completion = Completion.parse(JSON.parse(message.slice(index + COMPLETION_PREFIX.length)));
			return completion.saveAttemptId === input.saveAttemptId ? [completion] : [];
		});
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
		assert.equal(completion.audit.responseStatus, "completed", "judge must complete a valid comparison; rejected or invalid responses cannot make fallback health pass");
		assert(completion.audit.judgedCandidates.some((candidate) => candidate.id === wrapper.id && candidate.contentHash === wrapper.contentHash),
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
			comparisonPromptHash: completion.audit.promptHash,
			freshArchive: wrapper.readable && containsArticle ? "article-confirmed" : "article-not-confirmed",
			outcome: completion.outcome,
			selected: { id: selected.id, kind: selected.kind, fresh: selected.fresh, contentHash: selected.contentHash },
		};
	};

	return { verify };
}
