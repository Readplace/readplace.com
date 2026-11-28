import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { clickAndWaitForPageReload } from "./page-interactions";
import { backdateFormLoad } from "./upload-journey.browser";
import { MACOS_CHROME_USER_AGENT } from "./user-agents";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "correct-horse-battery-staple";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEEDED_PARAGRAPH =
	"<p>Reader view renders the uploaded text in a clean, distraction-free column so the reading experience stays consistent.</p>";
const SHARE_WITHHELD =
	'[data-test-share-slot] [data-test-action="share-withheld"]';
const DOWNLOADS_SLOT = "[data-test-downloads-slot]";

const EPUB_FILE = {
	name: "guest-book.epub",
	mimeType: "application/epub+zip",
	buffer: Buffer.concat([
		Buffer.from([0x50, 0x4b, 0x03, 0x04]),
		Buffer.alloc(26),
		Buffer.from("mimetypeapplication/epub+zip"),
		Buffer.alloc(6),
	]),
};
const TEXT_FILE = {
	name: "notes.txt",
	mimeType: "text/plain",
	buffer: Buffer.from(
		"These are plain notes, not a book or a recording.",
		"utf-8",
	),
};
const BOOK_FACTS = {
	kind: "book",
	title: "A Guest Book",
	authors: ["Ada Author"],
	sectionTitles: ["One", "Two", "Three"],
};

test.use({ userAgent: MACOS_CHROME_USER_AGENT });

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

async function uploadFile(
	page: Page,
	input: { startPath: string; file: typeof EPUB_FILE },
): Promise<string> {
	await page.goto(`${BASE_URL}${input.startPath}`, {
		waitUntil: "domcontentloaded",
	});
	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-upload-start] button[type="submit"]'),
	);
	const key = await page
		.locator('[data-test-upload-s3-form] input[name="key"]')
		.getAttribute("value");
	await page.locator("[data-test-upload-file]").setInputFiles(input.file);
	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-upload-s3-form] button[type="submit"]'),
	);
	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-upload-continue] button[type="submit"]'),
	);
	return z.string().parse(key).replace("pending/", "").replace("/original", "");
}

async function recordInspection(
	page: Page,
	input: { uploadId: string; inspection: Record<string, unknown> },
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/media-inspection`, {
		data: input,
	});
	assert.equal(
		response.status(),
		200,
		"the media-inspection fixture must record the verdict",
	);
}

async function checkAgain(page: Page): Promise<void> {
	await clickAndWaitForPageReload(
		page,
		page.locator("[data-test-upload-check-again]"),
	);
}

async function signUp(page: Page, email: string): Promise<void> {
	await page.waitForSelector("body.page-signup");
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('input[name="loadedAt"]').evaluate(backdateFormLoad);
	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-action="signup"]'),
	);
}

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(
		response.status(),
		201,
		"the e2e user fixture must create the owner",
	);
	return CreatedUser.parse(await response.json()).userId;
}

async function seedPrivateUpload(
	page: Page,
	input: { savedByUserId: string; kind: "book" | "audio"; fileName: string },
): Promise<string> {
	const url = `https://uploads.readplace.invalid/${randomBytes(16).toString("hex")}`;
	const response = await page.request.post(
		`${BASE_URL}/e2e/seed-crawled-article`,
		{
			data: {
				url,
				title: "A Private Upload",
				content: Array.from({ length: 6 }, () => SEEDED_PARAGRAPH).join("\n"),
				contentFetchedAt: CONTENT_FETCHED_AT,
				savedByUserId: input.savedByUserId,
				media: { kind: input.kind, fileName: input.fileName },
			},
		},
	);
	assert.equal(response.status(), 201, `the seed endpoint must create ${url}`);
	return SeededArticle.parse(await response.json()).articleId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-form="login"] button[type="submit"]'),
	);
	await page.waitForSelector("body.page-readlist");
}

async function openReader(page: Page, articleId: string): Promise<void> {
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
}

async function seededOwner(
	page: Page,
	input: { kind: "book" | "audio"; fileName: string; stamp: string },
): Promise<string> {
	const email = `upload-journey-${input.stamp}@example.com`;
	const userId = await createOwner(page, email);
	const articleId = await seedPrivateUpload(page, {
		savedByUserId: userId,
		kind: input.kind,
		fileName: input.fileName,
	});
	await loginAs(page, email);
	await openReader(page, articleId);
	return articleId;
}

function urlOf(href: string | null): URL {
	return new URL(z.string().parse(href), BASE_URL);
}

test("a guest uploads an EPUB, signs up from the review and saves it to the library", async ({
	page,
}, testInfo) => {
	const stamp = `${testInfo.workerIndex}-${Date.now()}`;
	const uploadId = await uploadFile(page, {
		startPath: "/upload",
		file: EPUB_FILE,
	});

	await expect(page.locator("#upload-status")).toHaveAttribute(
		"data-upload-status",
		"inspecting",
	);
	await recordInspection(page, {
		uploadId,
		inspection: { verdict: "inspected", facts: BOOK_FACTS },
	});
	await checkAgain(page);
	await page.waitForSelector("[data-test-upload-review]");
	await expect(page.locator("[data-test-upload-section]")).toHaveCount(3);

	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-upload-commit-form] button[type="submit"]'),
	);
	await signUp(page, `upload-journey-guest-${stamp}@example.com`);

	await page.waitForSelector("[data-test-upload-review]");
	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-upload-commit-form] button[type="submit"]'),
	);
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator("[data-test-article]")).toHaveCount(1);

	const href = await page
		.locator("[data-test-article-title]")
		.getAttribute("href");
	await page.goto(`${BASE_URL}${z.string().parse(href)}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
	await expect(page.locator(SHARE_WITHHELD)).toHaveAttribute(
		"aria-disabled",
		"true",
	);
});

test("a seeded private book withholds sharing and offers its EPUB download", async ({
	page,
}) => {
	await seededOwner(page, {
		kind: "book",
		fileName: "private-book.epub",
		stamp: `${Date.now()}-book`,
	});

	await expect(page.locator(SHARE_WITHHELD)).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(
		page.locator(`${DOWNLOADS_SLOT} [data-test-download="epub"]`),
	).toHaveCount(1);
});

test("a seeded private recording hides the EPUB download and answers its EPUB request with the reader", async ({
	page,
}) => {
	const articleId = await seededOwner(page, {
		kind: "audio",
		fileName: "private-recording.mp3",
		stamp: `${Date.now()}-audio`,
	});

	await expect(page.locator(DOWNLOADS_SLOT)).toHaveClass(
		/article-body__downloads-slot--hidden/,
	);
	await page.goto(`${BASE_URL}/queue/${articleId}/view?format=epub`, {
		waitUntil: "domcontentloaded",
	});
	await expect(page.locator("body.page-reader")).toHaveCount(1);
});

test("an upload rejected at review offers to upload again", async ({
	page,
}) => {
	const uploadId = await uploadFile(page, {
		startPath: "/upload",
		file: EPUB_FILE,
	});
	await recordInspection(page, {
		uploadId,
		inspection: {
			verdict: "rejected",
			reason: "unreadable",
			notice: "We couldn't open this book.",
		},
	});
	await checkAgain(page);

	const again = urlOf(
		await page.locator("[data-test-upload-again]").getAttribute("href"),
	);
	assert.equal(again.pathname, "/upload");
});

test("an upload of an unsupported file is refused and keeps the start form", async ({
	page,
}) => {
	await uploadFile(page, {
		startPath: "/upload",
		file: TEXT_FILE,
	});

	await expect(
		page.locator('[data-test-upload-error="upload_unsupported_type"]'),
	).toHaveCount(1);
	const start = urlOf(
		await page.locator("[data-test-upload-start]").getAttribute("action"),
	);
	assert.equal(start.pathname, "/upload");
});
