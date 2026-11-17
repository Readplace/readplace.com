import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const VIEWPORT = { width: 1280, height: 900 };
const IMAGE_HOST = "https://cdn.example.com";

type Variant = "today" | "measured";
type Box = { x: number; y: number; width: number; height: number };
type Layout = { images: Box[]; paragraphTops: number[] };

function pngChunk(chunk: { type: string; data: Buffer }): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(chunk.data.length);
	const typed = Buffer.concat([Buffer.from(chunk.type, "ascii"), chunk.data]);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(typed));
	return Buffer.concat([length, typed, checksum]);
}

function grayPng(size: { width: number; height: number }): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size.width, 0);
	header.writeUInt32BE(size.height, 4);
	header.writeUInt8(8, 8);
	const row = Buffer.alloc(size.width + 1, 128);
	row.writeUInt8(0, 0);
	const pixels = Buffer.concat(Array.from({ length: size.height }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk({ type: "IHDR", data: header }),
		pngChunk({ type: "IDAT", data: deflateSync(pixels) }),
		pngChunk({ type: "IEND", data: Buffer.alloc(0) }),
	]);
}

const LARGE = grayPng({ width: 1456, height: 1005 });
const HALF = grayPng({ width: 728, height: 503 });
const SMALL = grayPng({ width: 300, height: 200 });

const IMAGE_BYTES: Record<string, Buffer | undefined> = {
	"plain.png": LARGE,
	"small.png": SMALL,
	"zero.png": LARGE,
	"srcset-728.png": HALF,
	"srcset-1456.png": LARGE,
	"table.png": LARGE,
	"facade.png": LARGE,
	"broken.png": undefined,
	"mismatch.png": SMALL,
};

const IMAGE_KEYS = [
	"plain",
	"small",
	"zero",
	"srcset",
	"table",
	"facade",
	"broken",
	"mismatch",
] as const;
const RESERVED_KEYS = ["plain", "small", "zero", "srcset"] as const;
const UNRESERVED_KEYS = ["table", "facade"] as const;

function articleContent(variant: Variant): string {
	const src = (file: string): string => `${IMAGE_HOST}/${variant}/${file}`;
	const size = (value: string): string =>
		variant === "measured" ? ` data-reader-image-size="${value}"` : "";
	const between = (index: number, image: string): string =>
		`<p>Paragraph ${index} sits above an image.</p>${image}`;
	return [
		between(
			1,
			`<img src="${src("plain.png")}" width="1456" height="1005" alt=""${size("1456x1005")}>`,
		),
		between(2, `<img src="${src("small.png")}" alt=""${size("300x200")}>`),
		between(
			3,
			`<img src="${src("zero.png")}" width="0" height="0" alt=""${size("1456x1005")}>`,
		),
		between(
			4,
			`<img srcset="${src("srcset-728.png")} 728w, ${src("srcset-1456.png")} 1456w" sizes="100vw" alt=""${size("1456x1005 100vw")}>`,
		),
		between(
			5,
			`<table><tbody><tr><td><img src="${src("table.png")}" alt=""${size("1456x1005")}></td><td>Release</td><td>2026</td></tr><tr><td>Build</td><td>Passed</td><td>Green</td></tr></tbody></table>`,
		),
		between(
			6,
			`<p class="reader-embed-facade"><a href="https://example.com/watch"><img src="${src("facade.png")}" alt=""${size("1456x1005")}></a></p>`,
		),
		between(
			7,
			`<img src="${src("broken.png")}" alt="Chart"${size("1456x1005")}>`,
		),
		between(8, `<img src="${src("mismatch.png")}" alt=""${size("600x400")}>`),
		"<p>The last paragraph sits below every image.</p>",
	].join("");
}

async function seedArticle(
	page: Page,
	article: { variant: Variant; stamp: string },
): Promise<string> {
	const path = `example.com/reader-image-box-${article.stamp}-${article.variant}`;
	const seeded = await page.request.post(
		`${BASE_URL}/e2e/seed-crawled-article`,
		{
			data: {
				url: `https://${path}`,
				title: "Reader Image Box",
				content: articleContent(article.variant),
				contentFetchedAt: "2026-11-15T08:00:00.000Z",
			},
		},
	);
	assert.equal(
		seeded.status(),
		201,
		"seed endpoint must create the crawled article",
	);
	return path;
}

async function openHeld(
	context: BrowserContext,
	article: { path: string; variant: Variant },
) {
	const page = await context.newPage();
	let release: (() => void) | undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	assert(release, "the held image requests must expose their release");
	await page.route(`${IMAGE_HOST}/**`, async (route) => {
		await released;
		const file = new URL(route.request().url()).pathname.split("/").pop();
		assert(file, "every image URL names a file");
		const body = IMAGE_BYTES[file];
		if (body) {
			await route.fulfill({ status: 200, contentType: "image/png", body });
		} else {
			await route.fulfill({
				status: 404,
				contentType: "text/plain",
				body: "missing",
			});
		}
	});
	await page.goto(`${BASE_URL}/view/${article.path}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector(
		'[data-test-reader-slot][data-reader-status="ready"]',
	);
	await waitForInter(page);
	return { page, release };
}

function waitForInter(page: Page): Promise<unknown> {
	return page.waitForFunction(() =>
		Array.from(document.fonts).some(
			(font) =>
				font.family.replace(/^["']|["']$/g, "") === "Inter" &&
				font.status === "loaded",
		),
	);
}

function readLayout(page: Page): Promise<Layout> {
	return page.locator("[data-test-reader-content]").evaluate((content) => {
		const origin = content.getBoundingClientRect();
		const relative = (element: Element) => {
			const rect = element.getBoundingClientRect();
			return {
				x: rect.x - origin.x,
				y: rect.y - origin.y,
				width: rect.width,
				height: rect.height,
			};
		};
		return {
			images: Array.from(content.querySelectorAll("img"), relative),
			paragraphTops: Array.from(
				content.querySelectorAll("p"),
				(paragraph) => relative(paragraph).y,
			),
		};
	});
}

function imagesSettled(page: Page): Promise<boolean> {
	return page
		.locator("[data-test-reader-content]")
		.evaluate((content) =>
			Array.from(content.querySelectorAll("img")).every(
				(image) => image.complete,
			),
		);
}

async function releaseAndSettle(opened: {
	page: Page;
	release: () => void;
}): Promise<Layout> {
	opened.release();
	await expect.poll(() => imagesSettled(opened.page)).toBe(true);
	return readLayout(opened.page);
}

function boxOf(layout: Layout, key: (typeof IMAGE_KEYS)[number]): Box {
	const box = layout.images[IMAGE_KEYS.indexOf(key)];
	assert(box, `the reader must render the ${key} image`);
	return box;
}

function expectWithinHalfPixel(actual: Box, expected: Box): void {
	expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(0.5);
	expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(0.5);
	expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(0.5);
	expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(0.5);
}

function stampOf(testInfo: TestInfo, mode: string): string {
	return `${mode}-${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
}

test.describe("Reader image box", () => {
	test.use({ viewport: VIEWPORT });

	test("reserves a measured image's loaded box before its bytes arrive and changes nothing once they do", async ({
		context,
		page,
	}, testInfo) => {
		const stamp = stampOf(testInfo, "js");
		const todayPath = await seedArticle(page, { variant: "today", stamp });
		const measuredPath = await seedArticle(page, {
			variant: "measured",
			stamp,
		});

		const today = await openHeld(context, {
			path: todayPath,
			variant: "today",
		});
		const todayBefore = await readLayout(today.page);
		const todayAfter = await releaseAndSettle(today);

		const measured = await openHeld(context, {
			path: measuredPath,
			variant: "measured",
		});
		await measured.page.waitForSelector("html[data-reader-image-boxes]", {
			state: "attached",
		});
		const measuredBefore = await readLayout(measured.page);

		for (const key of RESERVED_KEYS) {
			expect(boxOf(measuredBefore, key).height).toBeGreaterThan(0);
			expectWithinHalfPixel(boxOf(measuredBefore, key), boxOf(todayAfter, key));
		}
		for (const key of UNRESERVED_KEYS) {
			const { x, width, height } = boxOf(measuredBefore, key);
			const unmeasured = boxOf(todayBefore, key);
			expect({ x, width, height }).toEqual({
				x: unmeasured.x,
				width: unmeasured.width,
				height: unmeasured.height,
			});
		}

		measured.release();
		await expect
			.poll(() =>
				measured.page
					.locator("[data-test-reader-content]")
					.evaluate((content) =>
						Array.from(content.querySelectorAll("img")).every(
							(image) =>
								image.complete &&
								!image.hasAttribute("data-reader-image-size") &&
								!image.hasAttribute("style"),
						),
					),
			)
			.toBe(true);
		expect(await readLayout(measured.page)).toEqual(todayAfter);
	});
});

test.describe("Reader image box without JavaScript", () => {
	test.use({ viewport: VIEWPORT, javaScriptEnabled: false });

	test("renders a measured article exactly as an unmeasured one before and after its images load", async ({
		context,
		page,
	}, testInfo) => {
		const stamp = stampOf(testInfo, "no-js");
		const todayPath = await seedArticle(page, { variant: "today", stamp });
		const measuredPath = await seedArticle(page, {
			variant: "measured",
			stamp,
		});

		const today = await openHeld(context, {
			path: todayPath,
			variant: "today",
		});
		const measured = await openHeld(context, {
			path: measuredPath,
			variant: "measured",
		});
		expect(await readLayout(measured.page)).toEqual(
			await readLayout(today.page),
		);

		const todayAfter = await releaseAndSettle(today);
		const measuredAfter = await releaseAndSettle(measured);
		expect(measuredAfter).toEqual(todayAfter);
	});
});
