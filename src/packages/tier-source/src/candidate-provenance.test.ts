import { SaveAttemptIdSchema } from "@packages/domain/article";
import { candidateProvenance } from "./candidate-provenance";

describe("candidate provenance", () => {
	it("changes immutable identity when attempt, source, or bytes change", () => {
		const params = { metadata: { title: "Title", siteName: "Site", excerpt: "Excerpt", wordCount: 1, estimatedReadTime: 1 }, html: "<p>one</p>", evaluationHtml: "<p>one</p>", attemptId: SaveAttemptIdSchema.parse("save"), originalUrl: "https://example.com/a", sourceUrl: "https://example.com/a", kind: "live" as const, fetchedAt: "2026-10-01T00:00:00Z" };
		const first = candidateProvenance(params);
		expect(candidateProvenance(params)).toEqual(first);
		for (const change of [{ html: "<p>localized media</p>" }, { attemptId: SaveAttemptIdSchema.parse("second") }, { evaluationHtml: "<p>two</p>" }, { sourceUrl: "https://example.com/b" }]) expect(candidateProvenance({ ...params, ...change }).id).not.toBe(first.id);
	});
	it("carries the capture trigger through provenance", () => {
		const params = { metadata: { title: "Title", siteName: "Site", excerpt: "Excerpt", wordCount: 1, estimatedReadTime: 1 }, html: "<p>one</p>", evaluationHtml: "<p>one</p>", attemptId: SaveAttemptIdSchema.parse("save"), originalUrl: "https://example.com/a", sourceUrl: "https://example.com/a", kind: "extension" as const, fetchedAt: "2026-10-01T00:00:00Z" };
		expect(candidateProvenance({ ...params, captureTrigger: "automatic" }).captureTrigger).toBe("automatic");
		expect(candidateProvenance(params).captureTrigger).toBeUndefined();
	});
	it("carries the render leg through provenance", () => {
		const params = { metadata: { title: "Title", siteName: "Site", excerpt: "Excerpt", wordCount: 1, estimatedReadTime: 1 }, html: "<p>one</p>", evaluationHtml: "<p>one</p>", attemptId: SaveAttemptIdSchema.parse("save"), originalUrl: "https://example-spa.test/post", sourceUrl: "https://example-spa.test/post", kind: "live" as const, fetchedAt: "2026-10-01T00:00:00Z" };
		const rendered = candidateProvenance({ ...params, renderedThrough: "residential-proxy" });
		expect(rendered.renderedThrough).toBe("residential-proxy");
		expect(candidateProvenance(params).renderedThrough).toBeUndefined();
	});
});
