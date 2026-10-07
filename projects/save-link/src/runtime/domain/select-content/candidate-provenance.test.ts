import { SaveAttemptIdSchema } from "@packages/domain/article";
import { candidateProvenance, initResolveCandidateOriginal } from "./candidate-provenance";

describe("candidate provenance", () => {
	it("changes immutable identity when attempt, source, or bytes change", () => {
		const params = { metadata: { title: "Title", siteName: "Site", excerpt: "Excerpt", wordCount: 1, estimatedReadTime: 1 }, html: "<p>one</p>", evaluationHtml: "<p>one</p>", attemptId: SaveAttemptIdSchema.parse("save"), originalUrl: "https://example.com/a", sourceUrl: "https://example.com/a", kind: "live" as const, fetchedAt: "2026-10-01T00:00:00Z" };
		const first = candidateProvenance(params);
		expect(candidateProvenance(params)).toEqual(first);
		for (const change of [{ html: "<p>localized media</p>" }, { attemptId: SaveAttemptIdSchema.parse("second") }, { evaluationHtml: "<p>two</p>" }, { sourceUrl: "https://example.com/b" }]) expect(candidateProvenance({ ...params, ...change }).id).not.toBe(first.id);
	});
	it("uses adopted identity and accepts ordinary legacy row identity", async () => {
		const resolveAdopted = initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article", originalUrl: "https://trusted.example/article" }) });
		expect(await resolveAdopted("https://redirector.example/a")).toBe("https://trusted.example/article");
		const resolveLegacy = initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article" }) });
		expect(await resolveLegacy("https://example.com/a")).toBe("https://example.com/a");
	});
	it("rejects a missing identity and unresolved legacy wrapper identity", async () => {
		const missing = initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "absent" }) });
		await expect(missing("https://example.com/a")).rejects.toThrow("existing article");
		const wrapper = initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article" }) });
		await expect(wrapper("https://web.archive.org/web/20081203/https://example.com/a")).rejects.toThrow("wrapper cannot");
	});
});
