import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

function multipartBody(filename: string, content: Buffer): { body: Buffer; contentType: string } {
	const boundary = "----TestBoundary123456";
	const head = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
	return {
		body: Buffer.concat([head, content, tail]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

const useApp = useTestServer();

describe("Import page SEO", () => {
	it("marks GET /import as indexable with the reading-readlist title and description", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"index, follow",
		);
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
			"https://readplace.com/import",
		);
		expect(doc.title).toBe("Import Links into Your Readlist — Readplace");
		expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
			"Paste a link or upload a bookmark, Pocket, or newsletter export and Readplace lists every URL for your reading readlist. No account needed to start.",
		);
		expect(doc.querySelector('meta[name="keywords"]')?.getAttribute("content")).toContain(
			"import links into a reading readlist",
		);
	});

	it("keeps the upload tab on the same canonical with the shared SEO section", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import?mode=upload");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"index, follow",
		);
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
			"https://readplace.com/import",
		);
		expect(doc.querySelector('[data-test-section="import-faq"]')).not.toBeNull();
	});

	it("renders the how-it-works, sources, and FAQ sections with the Pocket guide link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		const doc = new JSDOM(response.text).window.document;
		for (const section of ["import-how-it-works", "import-sources", "import-faq"]) {
			assert(
				doc.querySelector(`[data-test-section="${section}"]`),
				`${section} section must render`,
			);
		}
		const pocketLink = doc.querySelector(
			'[data-test-section="import-sources"] a[href="/blog/pocket-migration"]',
		);
		assert(pocketLink, "sources must link to the Pocket recovery guide");
	});

	it("emits WebPage and FAQPage JSON-LD where the FAQ matches the on-page text", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		const doc = new JSDOM(response.text).window.document;
		const blocks = Array.from(
			doc.querySelectorAll('script[type="application/ld+json"]'),
		).map((script) => JSON.parse(script.textContent ?? ""));
		expect(blocks.map((block) => block["@type"])).toEqual(["WebPage", "FAQPage"]);

		const webPage = blocks[0];
		expect(webPage["@id"]).toBe("https://readplace.com/import");
		expect(webPage.about["@id"]).toBe("https://readplace.com/#app");

		const jsonLdFaq = blocks[1].mainEntity.map(
			(entity: { name: string; acceptedAnswer: { text: string } }) => ({
				question: entity.name,
				answer: entity.acceptedAnswer.text,
			}),
		);
		const onPageFaq = Array.from(
			doc.querySelectorAll("[data-test-import-faq-question]"),
		).map((question, i) => ({
			question: question.textContent,
			answer: doc.querySelectorAll("[data-test-import-faq-answer]")[i].textContent,
		}));
		expect(onPageFaq.length).toBeGreaterThan(0);
		expect(jsonLdFaq).toEqual(onPageFaq);
	});

	it("keeps the review page out of search indexes", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { body, contentType } = multipartBody(
			"urls.txt",
			Buffer.from("https://example.com/a"),
		);

		const create = await request(harness.server)
			.post("/import")
			.set("Content-Type", contentType)
			.send(body);
		expect(create.status).toBe(303);
		const review = await request(harness.server).get(create.headers.location);

		expect(review.status).toBe(200);
		const doc = new JSDOM(review.text).window.document;
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"noindex, nofollow",
		);
	});
});
