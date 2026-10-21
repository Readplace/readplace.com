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
const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };

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

const SPLIT_BODIES_TABLE = [
	"<table><thead><tr><th>stage</th><th>owner</th></tr></thead>",
	"<tbody><tr><td>extract</td><td>parser</td></tr><tr><td>sanitise</td><td>reader</td></tr></tbody>",
	"<tbody><tr><td>render</td><td>web</td></tr></tbody></table>",
].join("");

const ROW_HEADERS_TABLE = [
	"<table><tbody>",
	"<tr><th>words</th><td>2,140</td></tr>",
	"<tr><th>read time</th><td>9 min</td></tr>",
	"</tbody></table>",
].join("");

const WIDE_CODE_LINE =
	"await renderArticle({ url, persona: 'reader', columnWidth: 648, embeds: true, tables: 'uncontained', images: 'intrinsic' });";

const HOSTILE_ARTICLE_BODY = [
	"<p>Extraction keeps whatever the publisher shipped, so the reader renders markup it never authored.</p>",
	WIDE_TABLE,
	SPLIT_BODIES_TABLE,
	ROW_HEADERS_TABLE,
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
		document.querySelector(".newer-version-banner")?.remove();
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

async function headingsHiddenWithoutLabel(page: Page): Promise<string[]> {
	return page.locator(READER_CONTENT).evaluate((content) => {
		const collapsedText = (element: Element) => String(element.textContent).replace(/\s+/g, " ").trim();
		const labelShown = (cell: Element) =>
			cell.getClientRects().length > 0 && !["none", "normal"].includes(getComputedStyle(cell, "::before").content);
		return Array.from(content.querySelectorAll("th"))
			.filter((heading) => collapsedText(heading) !== "" && heading.getClientRects().length === 0)
			.filter((heading) => {
				const table = heading.closest("table");
				const shownParts = Array.from(table?.querySelectorAll("[data-label]") ?? [])
					.filter((cell) => cell.closest("table") === table && labelShown(cell))
					.flatMap((cell) => String(cell.getAttribute("data-label")).split(" · "));
				return !shownParts.includes(collapsedText(heading));
			})
			.map(collapsedText);
	});
}

async function pageScrollsSideways(page: Page): Promise<boolean> {
	return page.evaluate(() => document.documentElement.scrollWidth !== document.documentElement.clientWidth);
}

interface ReaderContentExpectation {
	tableDisplays: readonly string[];
	ruleBetweenBodies: readonly string[];
	lastRowRules: readonly string[];
	splitBodiesLabelsShown: boolean;
}

function readerContentGeometry(expected: ReaderContentExpectation): (page: Page) => Promise<void> {
	return (page) => assertReaderContentGeometry({ page, expected });
}

async function assertReaderContentGeometry(input: { page: Page; expected: ReaderContentExpectation }): Promise<void> {
	const { page, expected } = input;
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
		const tables = Array.from(content.querySelectorAll("table"));
		const [wide, splitBodies, rowHeaders] = tables;
		const wideHeaderRow = wide?.tHead?.rows[0];
		const wideBody = wide?.tBodies[0];
		const firstBody = splitBodies?.tBodies[0];
		const lastRowHeaderRow = rowHeaders?.rows[rowHeaders.rows.length - 1];
		const firstBodyLastRow = firstBody?.rows[firstBody.rows.length - 1];
		if (!wideHeaderRow || !wideBody) {
			throw new Error("the reader fixture must render the wide table with a header row and a body");
		}
		if (!splitBodies || !rowHeaders || !firstBodyLastRow || !lastRowHeaderRow || splitBodies.tBodies.length !== 2) {
			throw new Error("the reader fixture must render the split-body table and the row-header table");
		}
		const rulesUnder = (pair: { table: HTMLTableElement; row: HTMLTableRowElement }) =>
			getComputedStyle(pair.table).display === "table"
				? Array.from(pair.row.cells, (cell) => getComputedStyle(cell).borderBottomWidth)
				: [getComputedStyle(pair.row).borderBottomWidth];
		const labelContent = (cell: Element) => getComputedStyle(cell, "::before").content;
		const lineCount = (cell: Element) => {
			const range = document.createRange();
			range.selectNodeContents(cell);
			return new Set(
				Array.from(range.getClientRects())
					.filter((rect) => rect.width > 0)
					.map((rect) => Math.round(rect.top)),
			).size;
		};
		const wideCells = Array.from(wideBody.rows, (row) => Array.from(row.cells));
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
			tableDisplays: tables.map((table) => getComputedStyle(table).display),
			wideHeaderRowRects: wideHeaderRow.getClientRects().length,
			wideLabels: wideCells.map((row) => row.map((cell) => cell.getAttribute("data-label"))),
			wideCellsWithoutLabelContent: wideCells
				.flat()
				.filter((cell) => ["none", "normal"].includes(labelContent(cell))).length,
			wideValueLineCounts: wideCells.flat().map(lineCount),
			splitBodiesLabelContents: Array.from(splitBodies.querySelectorAll("td"), labelContent),
			tableBorderModels: tables.map((table) => getComputedStyle(table).borderCollapse),
			tablesWiderThanColumn: tables.filter((table) => table.getBoundingClientRect().width > columnWidth + 1)
				.length,
			cellSideBorders: Array.from(content.querySelectorAll("td")).flatMap((cell) => {
				const style = getComputedStyle(cell);
				return [style.borderLeftWidth, style.borderRightWidth];
			}),
			ruleBetweenBodies: rulesUnder({ table: splitBodies, row: firstBodyLastRow }),
			lastRowHeaderTag: lastRowHeaderRow.cells[0]?.tagName,
			lastRowRules: rulesUnder({ table: rowHeaders, row: lastRowHeaderRow }),
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
	assert.deepEqual(
		measured.tableBorderModels,
		["separate", "separate", "separate"],
		"every reader table keeps separate borders so its rounded edge can draw",
	);
	assert.equal(measured.tablesWiderThanColumn, 0, "every reader table fits the content width");
	assert.deepEqual(
		measured.cellSideBorders,
		measured.cellSideBorders.map(() => "0px"),
		"table cells draw no side borders, only the rule under each row",
	);
	assert.deepEqual(
		measured.tableDisplays,
		expected.tableDisplays,
		"each table takes the layout its fit and the article column's width call for",
	);
	assert.equal(measured.wideHeaderRowRects, 0, "a stacked table hides the header row its labels carry");
	assert.deepEqual(
		measured.wideLabels,
		WIDE_TABLE_ROWS.map(() => WIDE_TABLE_HEADINGS),
		"every value of the wide table is labelled with its column heading",
	);
	assert.equal(measured.wideCellsWithoutLabelContent, 0, "every value of the stacked wide table shows its label");
	assert.deepEqual(
		measured.wideValueLineCounts,
		measured.wideValueLineCounts.map(() => 1),
		"no value of the stacked wide table wraps, so a code-like value never breaks mid-word",
	);
	assert.deepEqual(
		measured.splitBodiesLabelContents.map((content) => !["none", "normal"].includes(content)),
		measured.splitBodiesLabelContents.map(() => expected.splitBodiesLabelsShown),
		"a stacked table shows its labels and a grid table shows its header row instead",
	);
	assert.deepEqual(
		await headingsHiddenWithoutLabel(page),
		[],
		"stacking never hides a heading that no shown label repeats",
	);
	assert.deepEqual(
		measured.ruleBetweenBodies,
		expected.ruleBetweenBodies,
		"the rule between two table bodies stays, because only the table's final row loses it",
	);
	assert.equal(measured.lastRowHeaderTag, "TH", "the row-header fixture must end on a row header");
	assert.deepEqual(
		measured.lastRowRules,
		expected.lastRowRules,
		"a final row of row headers draws no rule against the table's own border",
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
	geometry: readerContentGeometry({
		tableDisplays: ["block", "table", "table"],
		ruleBetweenBodies: ["1px", "1px"],
		lastRowRules: ["0px", "0px"],
		splitBodiesLabelsShown: false,
	}),
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

test.describe("Reader keeps hostile crawled markup inside the card at the narrowest width", () => {
	test.use({ timezoneId: "UTC", viewport: WCAG_REFLOW_MINIMUM });

	test("the same tables, wide code and images stay inside the card at 320px and the page never scrolls sideways", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("readplace.extension-suggestion-dismissed", "1");
		});
		await pinFixtureImages(page);
		await seedHostileArticle(page);
		await openReader(page);
		await readerContentSettled(page);
		await readerContentGeometry({
			tableDisplays: ["block", "block", "block"],
			ruleBetweenBodies: ["1px"],
			lastRowRules: ["0px"],
			splitBodiesLabelsShown: true,
		})(page);
	});
});

const CAPTIONED_ARTICLE_URL = "https://example.com/reader-content-captioned-table";
const CAPTIONED_CANONICAL_PATH = "example.com/reader-content-captioned-table";
const CAPTIONED_TABLE = [
	"<table><caption>Pipeline owners</caption><colgroup><col><col></colgroup>",
	"<thead><tr><th>stage</th><th>owner</th></tr></thead>",
	"<tbody><tr><td>render</td><td>web</td></tr></tbody></table>",
].join("");

test.describe("Reader rounds a captioned table's top corners", () => {
	test.use({ timezoneId: "UTC", viewport: READER_VIEWPORT });

	test("a table led by a caption and a column group rounds its header row's outer corners", async ({ page }) => {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: CAPTIONED_ARTICLE_URL,
				title: "Reader Captioned Table",
				content: `<p>Publishers caption their tables.</p>${CAPTIONED_TABLE}`,
				contentFetchedAt: CONTENT_FETCHED_AT,
			},
		});
		assert.equal(seeded.status(), 201, "seed endpoint must create the crawled article");
		await page.goto(`${BASE_URL}/view/${CAPTIONED_CANONICAL_PATH}`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');

		const corners = await page.locator(`${READER_CONTENT} table`).evaluate((table) => {
			if (!(table instanceof HTMLTableElement) || !table.caption || !table.tHead) {
				throw new Error("the fixture must render a captioned table with a header row");
			}
			const headerCells = Array.from(table.tHead.rows[0]?.cells ?? []);
			const bodyCells = Array.from(table.tBodies[0]?.rows[0]?.cells ?? []);
			return {
				tableRadius: Number.parseFloat(getComputedStyle(table).borderTopLeftRadius),
				header: [
					Number.parseFloat(getComputedStyle(headerCells[0] ?? table).borderTopLeftRadius),
					Number.parseFloat(getComputedStyle(headerCells[headerCells.length - 1] ?? table).borderTopRightRadius),
				],
				bodyTop: [
					getComputedStyle(bodyCells[0] ?? table).borderTopLeftRadius,
					getComputedStyle(bodyCells[bodyCells.length - 1] ?? table).borderTopRightRadius,
				],
			};
		});

		assert.ok(corners.tableRadius > 1, "the reader table must draw rounded corners for this check to mean anything");
		assert.deepEqual(
			{ header: corners.header, bodyTop: corners.bodyTop },
			{ header: [corners.tableRadius - 1, corners.tableRadius - 1], bodyTop: ["0px", "0px"] },
			"a caption before the header must not square the header row's outer corners, nor round the body row under it",
		);
	});
});

const TABLE_LAYOUTS_ARTICLE_URL = "https://example.com/reader-content-table-layouts";
const TABLE_LAYOUTS_CANONICAL_PATH = "example.com/reader-content-table-layouts";
const TITLED_TABLE = [
	"<table><thead>",
	'<tr><th colspan="3">Bundle sizes</th></tr>',
	'<tr><th rowspan="2">target</th><th colspan="2">size</th></tr>',
	"<tr><th>raw</th><th>gzip</th></tr>",
	"</thead><tbody>",
	"<tr><th>reader</th><td>184KB</td><td>52KB</td></tr>",
	"<tr><th>parser</th><td>76KB</td><td>21KB</td></tr>",
	"</tbody></table>",
].join("");
const UNCARRIED_HEADING_TABLE = [
	"<table><thead><tr><th>step</th><th>notes</th></tr></thead><tbody>",
	"<tr><td>fetch</td><td></td></tr>",
	"<tr><td>parse</td><td></td></tr>",
	"</tbody></table>",
].join("");
const ONE_COLUMN_TABLE = [
	"<table><tbody>",
	"<tr><td><p>A one-column layout table reads as the text it holds.</p></td></tr>",
	"<tr><td><p>Its cells take the whole column.</p></td></tr>",
	"</tbody></table>",
].join("");
const TABLE_LAYOUTS_BODY = [
	"<p>A saved table takes the layout its columns fit.</p>",
	TITLED_TABLE,
	UNCARRIED_HEADING_TABLE,
	ONE_COLUMN_TABLE,
	"<p>Every table above follows the article column.</p>",
].join("");
const TITLED_TABLE_LABELS = ["target", "size · raw", "size · gzip"];

async function openTableLayouts(page: Page): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: TABLE_LAYOUTS_ARTICLE_URL,
			title: "Reader Table Layouts",
			content: TABLE_LAYOUTS_BODY,
			contentFetchedAt: CONTENT_FETCHED_AT,
		},
	});
	assert.equal(seeded.status(), 201, "seed endpoint must create the crawled article");
	await page.goto(`${BASE_URL}/view/${TABLE_LAYOUTS_CANONICAL_PATH}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
}

async function measureTableLayouts(page: Page) {
	return page.locator(READER_CONTENT).evaluate((content) => {
		const [titled, uncarried, oneColumn] = Array.from(content.querySelectorAll("table"));
		const titledBody = titled?.tBodies[0];
		const uncarriedHeaderRow = uncarried?.tHead?.rows[0];
		const oneColumnCell = oneColumn?.rows[0]?.cells[0];
		if (!titled || !titledBody || !uncarried || !uncarriedHeaderRow || !oneColumn || !oneColumnCell) {
			throw new Error("the table-layouts fixture must render the titled, uncarried-heading and one-column tables");
		}
		const titledBodyCells = Array.from(titledBody.rows, (row) => Array.from(row.cells));
		return {
			columnWidth: content.clientWidth,
			displays: [titled, uncarried, oneColumn].map((table) => getComputedStyle(table).display),
			titledRowsRendered: Array.from(titled.rows, (row) => row.getClientRects().length > 0),
			titledBodyLabels: titledBodyCells.map((row) => row.map((cell) => cell.getAttribute("data-label"))),
			titledBodyLabelContents: titledBodyCells.flat().map((cell) => getComputedStyle(cell, "::before").content),
			uncarriedHeaderRowRendered: uncarriedHeaderRow.getClientRects().length > 0,
			oneColumnDisplay: getComputedStyle(oneColumn).display,
			oneColumnBorderTop: getComputedStyle(oneColumn).borderTopWidth,
			oneColumnCellWidth: oneColumnCell.getBoundingClientRect().width,
			oneColumnCellPaddingLeft: getComputedStyle(oneColumnCell).paddingLeft,
		};
	});
}

async function assertTableLayoutsReadAtEveryWidth(input: {
	page: Page;
	layouts: Awaited<ReturnType<typeof measureTableLayouts>>;
}): Promise<void> {
	const { layouts } = input;
	assert.deepEqual(
		{ display: layouts.oneColumnDisplay, borderTop: layouts.oneColumnBorderTop },
		{ display: "block", borderTop: "0px" },
		"a one-column table drops its box so a layout table reads as the text it holds",
	);
	assert.ok(
		Math.abs(layouts.oneColumnCellWidth - layouts.columnWidth) <= 1,
		"a one-column table's cell takes the whole article column",
	);
	assert.equal(layouts.oneColumnCellPaddingLeft, "0px", "a one-column table's cell adds no padding to the text");
	assert.deepEqual(await headingsHiddenWithoutLabel(input.page), [], "no heading is hidden unless a shown label repeats it");
	assert.equal(await pageScrollsSideways(input.page), false, "no table layout scrolls the reader page sideways");
}

test.describe("Reader stacks every table when the rail narrows the article column", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1024, height: 900 } });

	test("a titled table stacks with its title visible, and a heading no label carries stays shown", async ({ page }) => {
		await openTableLayouts(page);
		const layouts = await measureTableLayouts(page);

		assert.ok(
			layouts.columnWidth < 600,
			"the 1024px viewport must narrow the column under 37.5rem for this check to mean anything",
		);
		assert.deepEqual(layouts.displays, ["block", "block", "block"], "every table stacks in a column under 37.5rem");
		assert.deepEqual(
			layouts.titledRowsRendered,
			[true, false, false, true, true],
			"a stacked table keeps its title row and hides only the header rows its labels carry",
		);
		assert.deepEqual(
			layouts.titledBodyLabels,
			[TITLED_TABLE_LABELS, TITLED_TABLE_LABELS],
			"each value is labelled with every heading above it, outer row first, and never with the title",
		);
		assert.deepEqual(
			layouts.titledBodyLabelContents.filter((content) => ["none", "normal"].includes(content)),
			[],
			"every value of a stacked table shows its label",
		);
		assert.equal(
			layouts.uncarriedHeaderRowRendered,
			true,
			"a header row stays visible when one of its headings has no labelled value under it",
		);
		await assertTableLayoutsReadAtEveryWidth({ page, layouts });
	});
});

test.describe("Reader lays a fitting table out as a grid in a wide article column", () => {
	test.use({ timezoneId: "UTC", viewport: READER_VIEWPORT });

	test("tables that fit become grids with every row visible, and a one-column table still reads as text", async ({
		page,
	}) => {
		await openTableLayouts(page);
		const layouts = await measureTableLayouts(page);

		assert.ok(
			layouts.columnWidth >= 600,
			"the 1280px viewport must widen the column to 37.5rem or more for this check to mean anything",
		);
		assert.deepEqual(
			layouts.displays,
			["table", "table", "block"],
			"a table that fits becomes a grid in a column of 37.5rem or more",
		);
		assert.deepEqual(
			layouts.titledRowsRendered,
			[true, true, true, true, true],
			"a grid table shows every header row",
		);
		assert.deepEqual(
			layouts.titledBodyLabels,
			[TITLED_TABLE_LABELS, TITLED_TABLE_LABELS],
			"a grid table's values keep their labels for the stacked layout",
		);
		assert.deepEqual(
			layouts.titledBodyLabelContents,
			layouts.titledBodyLabelContents.map(() => "none"),
			"a grid table shows its header instead of a label on each value",
		);
		await assertTableLayoutsReadAtEveryWidth({ page, layouts });
	});
});
