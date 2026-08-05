import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const ARTICLE_URL = "https://example.com/reader-content-visual";
const CANONICAL_PATH = "example.com/reader-content-visual";
const CONTENT_FETCHED_AT = "2026-04-27T08:00:00.000Z";
const READER_CONTENT = "[data-test-reader-content]";
const READER_VIEWPORT = { width: 1280, height: 900 };

interface FixtureImage {
	width: number;
	height: number;
	fill: string;
}

const WIDE_IMAGE_URL = "https://cdn.example.com/reader-release-pipeline.svg";
const NARROW_IMAGE_URL = "https://cdn.example.com/reader-reproducible-badge.svg";
const EMBED_VIDEO_ID = "readplace-e2e-fixture";
const EMBED_WATCH_URL = `https://www.youtube.com/watch?v=${EMBED_VIDEO_ID}`;
const EMBED_POSTER_URL = `https://i.ytimg.com/vi/${EMBED_VIDEO_ID}/hqdefault.jpg`;

const FIXTURE_IMAGES = new Map<string, FixtureImage>([
	[WIDE_IMAGE_URL, { width: 800, height: 210, fill: "#B9712A" }],
	[NARROW_IMAGE_URL, { width: 120, height: 80, fill: "#2A71B9" }],
	[EMBED_POSTER_URL, { width: 480, height: 360, fill: "#3B3B3B" }],
]);

function solidSvg(image: FixtureImage): string {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}"`,
		` viewBox="0 0 ${image.width} ${image.height}">`,
		`<rect width="${image.width}" height="${image.height}" fill="${image.fill}"/>`,
		"</svg>",
	].join("");
}

async function pinFixtureImages(page: Page): Promise<void> {
	await page.route(
		(url) => FIXTURE_IMAGES.has(url.toString()),
		(route) => {
			const image = FIXTURE_IMAGES.get(route.request().url());
			assert(image, "the route predicate admits only URLs present in the fixture map");
			return route.fulfill({ contentType: "image/svg+xml", body: solidSvg(image) });
		},
	);
}

const WIDE_TABLE_HEADINGS = [
	"checksum",
	"artefact",
	"platform",
	"toolchain",
	"size",
	"built",
	"signer",
	"status",
];
const WIDE_TABLE_ROWS = [
	["0xa41f9c72e5d8b1", "reader-core", "darwin-arm64", "clang-19.1.0", "18.4MB", "2026-04-02", "release-bot", "verified"],
	["0xb73d0e19afc264", "reader-core", "linux-x86-64", "gcc-14.2.0", "19.1MB", "2026-04-02", "release-bot", "verified"],
	["0xc02e88fa3d5719", "reader-parser", "linux-x86-64", "gcc-14.2.0", "7.6MB", "2026-04-03", "release-bot", "pending"],
];
const WIDE_TABLE = [
	"<table><thead><tr>",
	WIDE_TABLE_HEADINGS.map((heading) => `<th>${heading}</th>`).join(""),
	"</tr></thead><tbody>",
	WIDE_TABLE_ROWS.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join(""),
	"</tbody></table>",
].join("");

const WIDE_CODE_LINE =
	"await renderArticle({ url, persona: 'reader', columnWidth: 648, embeds: true, tables: 'uncontained', images: 'intrinsic' });";

const HOSTILE_ARTICLE_BODY = [
	"<p>Extraction keeps whatever the publisher shipped, so the reader renders markup it never authored.</p>",
	WIDE_TABLE,
	`<pre><code>${WIDE_CODE_LINE}</code></pre>`,
	`<img width="0" height="0" src="${WIDE_IMAGE_URL}" alt="Release pipeline diagram">`,
	`<img src="${NARROW_IMAGE_URL}" alt="Reproducible build badge">`,
	`<p class="reader-embed-facade"><a href="${EMBED_WATCH_URL}" target="_blank" rel="noopener noreferrer"><img src="${EMBED_POSTER_URL}" alt="Watch on YouTube" loading="lazy"></a></p>`,
	"<p>Inline samples such as <code>&lt;form&gt;</code>, <code>&lt;input&gt;</code> and <code>&lt;select&gt;</code> stay text.</p>",
	'<pre><code>&lt;form action="/search"&gt;\n  &lt;input name="q" value="reader"&gt;\n  &lt;select name="scope"&gt;&lt;option&gt;all&lt;/option&gt;&lt;/select&gt;\n&lt;/form&gt;</code></pre>',
	'<p style="position: fixed; inset: 0; z-index: 99999;">Captured markup cannot pin itself over the page chrome.</p>',
	"<p>Every block above has to stay inside the reader column.</p>",
].join("");

async function seedHostileArticle(page: Page): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: ARTICLE_URL,
			title: "Reader Content Visual",
			content: HOSTILE_ARTICLE_BODY,
			contentFetchedAt: CONTENT_FETCHED_AT,
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
}

async function openReader(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/view/${CANONICAL_PATH}`, { waitUntil: "domcontentloaded" });
}

async function readerContentSettled(page: Page): Promise<void> {
	await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
		document.querySelector(".trial-countdown")?.remove();
		document.querySelector(".view__share-row")?.remove();
		document.querySelector("[data-test-view-cta]")?.remove();
	});
	await page.waitForFunction((selector) => {
		const content = document.querySelector(selector);
		if (!content) return false;
		const images = Array.from(content.querySelectorAll("img"));
		if (images.length === 0) return false;
		return images.every((image) => image.complete && image.naturalWidth > 0);
	}, READER_CONTENT);
}

async function readerContentGeometry(page: Page): Promise<void> {
	const measured = await page.locator(READER_CONTENT).evaluate((content) => {
		const wideCode = content.querySelector("pre");
		const images = Array.from(content.querySelectorAll("img"));
		const [zeroWidthHintImage, narrowImage] = images;
		const facadeLink = content.querySelector(".reader-embed-facade a");
		if (!wideCode || !zeroWidthHintImage || !narrowImage || !facadeLink) {
			throw new Error(
				"the reader fixture must render the wide code block, both images and the embed facade",
			);
		}
		const columnWidth = content.clientWidth;
		const narrowBox = narrowImage.getBoundingClientRect();
		const facadeBox = facadeLink.getBoundingClientRect();
		wideCode.scrollLeft = wideCode.scrollWidth;
		const wideCodeReachableScrollLeft = wideCode.scrollLeft;
		wideCode.scrollLeft = 0;
		return {
			columnWidth,
			blocksWiderThanColumn: Array.from(content.children)
				.filter((block) => block.getBoundingClientRect().width > columnWidth + 1)
				.map((block) => block.tagName.toLowerCase()),
			wideCodeClientWidth: wideCode.clientWidth,
			wideCodeScrollWidth: wideCode.scrollWidth,
			wideCodeReachableScrollLeft,
			imageCount: images.length,
			zeroWidthHintImageClientWidth: zeroWidthHintImage.clientWidth,
			collapsedImageSources: images
				.filter((image) => image.clientWidth === 0)
				.map((image) => image.src),
			narrowImageClientWidth: narrowImage.clientWidth,
			narrowImageNaturalWidth: narrowImage.naturalWidth,
			narrowImageGapLeft: narrowBox.left - content.getBoundingClientRect().left,
			narrowImageGapRight: content.getBoundingClientRect().right - narrowBox.right,
			facadeWidth: facadeBox.width,
			facadeHeight: facadeBox.height,
			liveFormControls: content.querySelectorAll("form, input, select").length,
			pinnedBlocks: Array.from(content.querySelectorAll("*")).filter((element) => {
				const position = getComputedStyle(element).position;
				return position === "fixed" || position === "sticky";
			}).length,
		};
	});
	const pageOverflow = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));

	assert.equal(
		pageOverflow.scrollWidth,
		pageOverflow.clientWidth,
		"content wider than the column must stay inside the column and never scroll the reader page sideways",
	);
	assert.deepEqual(
		measured.blocksWiderThanColumn,
		[],
		"no article block may be laid out wider than the reader column — in the page's own document there is no frame left to absorb the overflow",
	);
	assert.equal(
		measured.wideCodeClientWidth,
		measured.columnWidth,
		"a wide non-table block must be laid out at column width, not pushed past it",
	);
	assert.ok(
		measured.wideCodeScrollWidth > measured.wideCodeClientWidth,
		"the wide code block fixture must be wider than the column for containment to mean anything",
	);
	assert.ok(
		measured.wideCodeReachableScrollLeft > 0,
		"a wide non-table block must scroll inside its own box instead of spilling into the page",
	);
	assert.equal(
		measured.imageCount,
		FIXTURE_IMAGES.size,
		"the fixture must still carry every image the reader has to lay out",
	);
	assert.deepEqual(
		measured.collapsedImageSources,
		[],
		"every reader image must render at a non-zero width",
	);
	assert.equal(
		measured.zeroWidthHintImageClientWidth,
		measured.columnWidth,
		"an image carrying the extraction-time zero-width hint must recover its intrinsic size and fill the column",
	);
	assert.equal(
		measured.narrowImageClientWidth,
		measured.narrowImageNaturalWidth,
		"a narrow image keeps its intrinsic width instead of being stretched to the column",
	);
	assert.ok(
		measured.narrowImageClientWidth < measured.columnWidth,
		"the narrow image fixture must be narrower than the column for centring to mean anything",
	);
	assert.ok(
		Math.abs(measured.narrowImageGapLeft - measured.narrowImageGapRight) <= 1,
		"a narrow image sits centred in the column instead of stranded against its left edge",
	);
	assert.ok(
		Math.abs(measured.facadeHeight - (measured.facadeWidth * 9) / 16) <= 1,
		"the embed facade holds a 16:9 box while its poster loads",
	);
	assert.equal(
		measured.liveFormControls,
		0,
		"escaped inline code samples must render as text, never as live form controls",
	);
	assert.equal(
		measured.pinnedBlocks,
		0,
		"captured markup must not be able to pin itself over the page chrome now that it shares the page's document",
	);
}

const READER_CONTENT_HOSTILE_MARKUP: VisualCheckpoint = {
	name: "reader-content-hostile-markup",
	settled: readerContentSettled,
	geometry: readerContentGeometry,
	target: READER_CONTENT,
	capture: "element",
	pinnedText: [],
};

test.describe("Reader renders hostile crawled markup inside the column", () => {
	test.use({ timezoneId: "UTC", viewport: READER_VIEWPORT });

	test("a wide table, wide code, a zero-width image, a narrow image, an embed facade and escaped samples all stay contained", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("readplace.extension-suggestion-dismissed", "1");
		});
		await pinFixtureImages(page);
		await page.emulateMedia({ colorScheme: "light" });
		await seedHostileArticle(page);
		await openReader(page);
		await captureCheckpoint(page, READER_CONTENT_HOSTILE_MARKUP);
	});
});
