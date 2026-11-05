import { ARTICLE_SECTION_ID_PREFIX } from "@packages/domain/article";
import { sampleSectionsForSummary } from "./sample-sections";
import { stripHtml } from "./strip-html";

function chapter(params: { id: string; heading: string; body: string }): string {
	return `<h2 id="${ARTICLE_SECTION_ID_PREFIX}${params.id}">${params.heading}</h2><p>${params.body}</p>`;
}

describe("sampleSectionsForSummary", () => {
	it("returns the cleaned whole when it fits the cap", () => {
		const html = `<p>Prelude.</p>${chapter({ id: "one", heading: "One", body: "First chapter." })}`;

		const result = sampleSectionsForSummary({ html, maxChars: 1_000, cleanContent: stripHtml });

		expect(result).toBe(stripHtml(html));
	});

	it("draws the head of every section when the whole is over the cap", () => {
		const html = [
			"<p>Prelude text.</p>",
			chapter({ id: "one", heading: "Chapter One", body: "a".repeat(500) }),
			chapter({ id: "two", heading: "Chapter Two", body: "b".repeat(500) }),
			chapter({ id: "three", heading: "Chapter Three", body: "c".repeat(500) }),
		].join("");

		const result = sampleSectionsForSummary({ html, maxChars: 200, cleanContent: stripHtml });

		expect(result.split("\n\n")).toEqual([
			"Prelude text.",
			expect.stringMatching(/^Chapter One a+$/),
			expect.stringMatching(/^Chapter Two b+$/),
			expect.stringMatching(/^Chapter Three c+$/),
		]);
		expect(result.length).toBeLessThanOrEqual(200);
	});

	it("gives the characters a short section leaves unused to the longer ones", () => {
		const html = [
			chapter({ id: "one", heading: "One", body: "a".repeat(10) }),
			chapter({ id: "two", heading: "Two", body: "b".repeat(500) }),
			chapter({ id: "three", heading: "Three", body: "c".repeat(500) }),
		].join("");

		const result = sampleSectionsForSummary({ html, maxChars: 300, cleanContent: stripHtml });

		expect(result.split("\n\n").map((section) => section.length)).toEqual([14, 141, 141]);
		expect(result.length).toBe(300);
	});

	it("splits a public body at every h2, with or without an id", () => {
		const html = `<h2>Plain heading</h2><p>${"a".repeat(100)}</p><h2 id="other">Other</h2><p>${"b".repeat(100)}</p>`;

		const result = sampleSectionsForSummary({ html, maxChars: 50, cleanContent: stripHtml });

		expect(result.split("\n\n")).toEqual([
			expect.stringMatching(/^Plain heading a+$/),
			expect.stringMatching(/^Other b+$/),
		]);
		expect(result.length).toBe(50);
	});

	it("leaves out a section that has no text", () => {
		const html = [
			chapter({ id: "one", heading: "One", body: "a".repeat(100) }),
			`<h2 id="${ARTICLE_SECTION_ID_PREFIX}blank"></h2>`,
			chapter({ id: "two", heading: "Two", body: "b".repeat(100) }),
		].join("");

		const result = sampleSectionsForSummary({ html, maxChars: 102, cleanContent: stripHtml });

		expect(result.split("\n\n")).toEqual([
			expect.stringMatching(/^One a+$/),
			expect.stringMatching(/^Two b+$/),
		]);
		expect(result.length).toBe(102);
	});
});
