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
			'[data-test-section="import-sources"] a[href^="/blog/pocket-migration?utm_source=import-acquire"]',
		);
		assert(pocketLink, "sources must link to the Pocket recovery guide");
	});

	it("keeps the steps and the sources announced as lists once CSS removes their markers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		const doc = new JSDOM(response.text).window.document;
		const lists = ["import-how-it-works", "import-sources"].map((section) => {
			const list = doc.querySelector(`[data-test-section="${section}"] .disclosure-card__body`);
			assert(list, `${section} must render its list`);
			return `${list.tagName.toLowerCase()} ${list.getAttribute("role")}`;
		});
		expect(lists).toEqual(["ol list", "ul list"]);
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

	it("renders the H1 'Import links to your readlist'", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		const doc = new JSDOM(response.text).window.document;
		const headings = Array.from(doc.querySelectorAll("h1")).map((h1) => h1.textContent);
		expect(headings).toEqual(["Import links to your readlist"]);
	});

	it("keeps every FAQ answer in the page while the items render closed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		const doc = new JSDOM(response.text).window.document;
		const items = Array.from(doc.querySelectorAll<HTMLDetailsElement>("details.import__faq-item"));
		expect(items).toHaveLength(5);
		expect(items.map((item) => item.open)).toEqual([false, false, false, false, false]);
		const answers = items.map((item) => item.querySelector("[data-test-import-faq-answer]")?.textContent?.trim().length ?? 0);
		expect(answers.map((length) => length > 0)).toEqual([true, true, true, true, true]);
	});

	it("returns every FAQ answer and each row's title with its text in the markdown form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const html = await request(harness.server).get("/import");
		const markdown = await request(harness.server).get("/import").set("Accept", "text/markdown");

		expect(markdown.status).toBe(200);
		expect(markdown.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		const doc = new JSDOM(html.text).window.document;
		const answers = Array.from(doc.querySelectorAll("[data-test-import-faq-answer]")).map(
			(answer) => answer.textContent ?? "",
		);
		expect(answers).toHaveLength(5);
		for (const answer of answers) {
			expect(markdown.text).toContain(answer);
		}
		expect(markdown.text).toContain("**Newsletters and blogrolls** Paste the page URL");
		const firstStep = markdown.text.split("\n").find((line) => line.includes("**Paste a link or upload a file**"));
		expect(firstStep).toMatch(/^1\. \*\*Paste a link or upload a file\*\* Any page URL works/);
	});

	it("keeps the review page out of search indexes", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { body, contentType } = multipartBody(
			"urls.txt",
			Buffer.from("https://example.com/a"),
		);

		const create = await request(harness.server)
			.post("/import?utm_source=import-acquire&utm_medium=internal&utm_content=upload-file")
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
