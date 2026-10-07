import { createHash } from "node:crypto";
import { initArchiveHealthEvidence } from "./archive-health-evidence";
import type { ArchiveSaveHealthSource } from "./health-sources";

const ATTEMPT = "12c9f733-a806-4734-9d76-2d466e41d473";
const ORIGINAL = "https://example.com/article";
const CAPTURE = `https://web.archive.org/web/2008/${ORIGINAL}`;
const ARTICLE = "<p>The original article survived.</p>";
const source: ArchiveSaveHealthSource = {
	label: "Wayback", url: CAPTURE, expectedDestinationUrl: ORIGINAL,
	expectedContent: "The original article survived.", expectsThumbnail: false,
	save: { kind: "archive", captureUrl: CAPTURE, requireFreshArchive: true },
};

function candidate(input: { id?: string; kind?: "live" | "wrapper" | "extension"; fresh?: boolean; readable?: boolean; html?: string; sourceUrl?: string; originalUrl?: string } = {}) {
	return {
		id: input.id ?? "new-wrapper", kind: input.kind ?? "wrapper", originalUrl: input.originalUrl ?? ORIGINAL,
		sourceUrl: input.sourceUrl ?? CAPTURE, fresh: input.fresh ?? true, readable: input.readable ?? true,
		contentHash: createHash("sha256").update(input.html ?? ARTICLE).digest("hex"),
		evaluationLocation: "immutable/evaluation.html", httpStatus: 200,
	};
}

function message(input: { candidates?: ReturnType<typeof candidate>[]; selectedCandidateId?: string; saveAttemptId?: string; outcome?: "selected" | "retained" | "no-readable" } = {}) {
	return `[ArchiveSaveAttempt] comparison completed ${JSON.stringify({
		saveAttemptId: input.saveAttemptId ?? ATTEMPT, url: ORIGINAL,
		candidates: input.candidates ?? [candidate()], selectedCandidateId: input.selectedCandidateId ?? "new-wrapper",
		outcome: input.outcome ?? "selected",
		liveAttempt: { outcome: "no-body" },
		audit: {
			judgedCandidates: (input.candidates ?? [candidate()]).map(({ id, contentHash }) => ({ id, contentHash })),
			promptHash: "a".repeat(64), responseStatus: "completed",
		},
	})}\n`;
}

it("requires a completion for the accepted save instead of matching an earlier successful crawl", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	expect(await evidence.verify({ source, saveAttemptId: ATTEMPT, messages: ["unrelated log", message({ saveAttemptId: "4d4e6d33-260c-40d1-aeff-01c963d75438" })] })).toBeUndefined();
});

it("verifies the current wrapper artifact against the bytes supplied to the judge", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	expect(await evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [message()] })).toMatchObject({
		freshArchive: "article-confirmed", outcome: "selected", selected: { kind: "wrapper", fresh: true },
	});
	const stale = initArchiveHealthEvidence({ readEvaluation: async () => "old unrelated content" });
	await expect(stale.verify({ source, saveAttemptId: ATTEMPT, messages: [message()] })).rejects.toThrow("body hash");
});

it("passes fresh Wayback evidence when its readable article loses to a more complete live candidate", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	expect(await evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [message({
		candidates: [candidate(), candidate({ id: "live", kind: "live", sourceUrl: ORIGINAL })], selectedCandidateId: "live",
	})] })).toMatchObject({ freshArchive: "article-confirmed", selected: { kind: "live" } });
});

it("accepts a hash-verified legacy candidate without an immutable location while still requiring the current wrapper artifact", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	const completion = message({ candidates: [candidate(), candidate({ id: "legacy", kind: "extension", fresh: false, sourceUrl: ORIGINAL })] });
	const legacyWithoutLocation = completion.replace(/,"evaluationLocation":"immutable\/evaluation.html"(?=,"httpStatus":200\}\],)/, "");
	expect(legacyWithoutLocation).not.toBe(completion);
	expect(await evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [legacyWithoutLocation] })).toMatchObject({ freshArchive: "article-confirmed" });
	const wrapperWithoutLocation = message().replace(',"evaluationLocation":"immutable/evaluation.html"', "");
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [wrapperWithoutLocation] })).rejects.toThrow("current wrapper must provide");
});

it("fails Wayback fresh health when CAPTCHA loses to a retained readable article", async () => {
	const captcha = "<p>Please solve this CAPTCHA.</p>";
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => captcha });
	const messages = [message({
		candidates: [candidate({ html: captcha, readable: false }), candidate({ id: "retained-wrapper", fresh: false })],
		selectedCandidateId: "retained-wrapper", outcome: "retained",
	})];
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages })).rejects.toThrow("retained content cannot make archive health pass");
});

it("fails a redelivered current wrapper that is retained despite its latest unreadable verdict", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	const messages = [message({ candidates: [candidate({ readable: false })], selectedCandidateId: "new-wrapper", outcome: "retained" })];
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages })).rejects.toThrow("fresh Wayback response is not a readable article");
});

it("reports archive.today CAPTCHA fallback truthfully, including an extension retained on a tie", async () => {
	const captcha = "<p>Verify you are human</p>";
	const archiveSource: ArchiveSaveHealthSource = { ...source, label: "archive.today", save: { kind: "archive", captureUrl: CAPTURE, requireFreshArchive: false } };
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => captcha });
	const result = await evidence.verify({ source: archiveSource, saveAttemptId: ATTEMPT, messages: [message({
		candidates: [candidate({ html: captcha, readable: false }), candidate({ id: "extension", kind: "extension", fresh: false, sourceUrl: ORIGINAL })],
		selectedCandidateId: "extension", outcome: "retained",
	})] });
	expect(result).toMatchObject({ freshArchive: "article-not-confirmed", outcome: "retained", selected: { kind: "extension", fresh: false } });
});

it("does not call a long readable-looking challenge page a successful fresh archive copy", async () => {
	const challenge = "<article>Please verify your browser before continuing. These are all the challenge instructions.</article>";
	const archiveSource: ArchiveSaveHealthSource = { ...source, save: { kind: "archive", captureUrl: CAPTURE, requireFreshArchive: false } };
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => challenge });
	const result = await evidence.verify({ source: archiveSource, saveAttemptId: ATTEMPT, messages: [message({
		candidates: [candidate({ html: challenge, readable: true }), candidate({ id: "live", kind: "live", sourceUrl: ORIGINAL })],
		selectedCandidateId: "live",
	})] });
	expect(result).toMatchObject({ freshArchive: "article-not-confirmed", selected: { kind: "live", fresh: true } });
});

it("waits for the live side to settle before accepting a wrapper-only intermediate comparison", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	const wrapperOnly = message().replace(',"liveAttempt":{"outcome":"no-body"}', "");
	expect(await evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [wrapperOnly] })).toBeUndefined();
	const deferredLive = message().replace('"liveAttempt":{"outcome":"no-body"}', '"liveAttempt":{"outcome":"deferred"}');
	expect(await evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [deferredLive] })).toBeUndefined();
	const completed = message({ candidates: [candidate(), candidate({ id: "live", kind: "live", sourceUrl: ORIGINAL })] }).replace(',"liveAttempt":{"outcome":"no-body"}', "");
	expect(await evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [wrapperOnly, completed] })).toMatchObject({ freshArchive: "article-confirmed" });
});

it("does not accept a missing current wrapper candidate when the reader already has an archive copy", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [message({ candidates: [candidate({ fresh: false })] })] })).rejects.toThrow("current wrapper response");
});

it("makes calendar health depend on the latest capture requested by this save", async () => {
	const calendarSource: ArchiveSaveHealthSource = { ...source, save: { kind: "archive", captureUrl: `https://web.archive.org/web/${ORIGINAL}`, requireFreshArchive: true } };
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	await expect(evidence.verify({ source: calendarSource, saveAttemptId: ATTEMPT, messages: [message()] })).rejects.toThrow("latest capture");
});

it("fails when the fresh archive candidate lacks the expected article even if classified readable", async () => {
	const evaluation = "<p>A different readable article</p>";
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => evaluation });
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [message({ candidates: [candidate({ html: evaluation })] })] })).rejects.toThrow("missing expected article");
});

it("never counts the no-readable verdict as a successful fallback", async () => {
	const archiveSource: ArchiveSaveHealthSource = { ...source, save: { kind: "archive", captureUrl: CAPTURE, requireFreshArchive: false } };
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	await expect(evidence.verify({ source: archiveSource, saveAttemptId: ATTEMPT, messages: [message({ outcome: "no-readable" })] })).rejects.toThrow("no readable article");
});

it("does not pass fallback health when the provider rejected the request or did not yield a valid comparison", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	const rejected = message().replace('"responseStatus":"completed"', '"responseStatus":"rejected"');
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [rejected] })).rejects.toThrow("valid comparison");
	const omitted = message().replace('"judgedCandidates":[{"id":"new-wrapper"', '"judgedCandidates":[{"id":"old-wrapper"');
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [omitted] })).rejects.toThrow("actual judge request");
});

it("rejects candidates from a different original and selected IDs absent from the candidate set", async () => {
	const evidence = initArchiveHealthEvidence({ readEvaluation: async () => ARTICLE });
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [message({ candidates: [candidate({ originalUrl: "https://other.example/article" })] })] })).rejects.toThrow("different original");
	await expect(evidence.verify({ source, saveAttemptId: ATTEMPT, messages: [message({ selectedCandidateId: "missing" })] })).rejects.toThrow("actually selected or retained");
});
