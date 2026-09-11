import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const SECTION = "[data-test-gmail-senders]";
const SENDER_INPUT = "#gmail-sender";
const DESTINATION_SELECT = "[data-test-gmail-destination]";
const INBOX_NAME_INPUT = "[data-test-gmail-inbox-name]";
const MAPPED_ADDRESS = "[data-test-gmail-sender-mapped]";

const PINNED_MAPPED_ADDRESS = "tldr-a7b2c9@read.place";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openForwardingInboxes(page: Page, stamp: string): Promise<void> {
	const email = `gmail-inboxes-visual-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId,
			state: "filtering",
			senders: [
				{ email: "dan@tldr.tech", place: "mapped", subject: "TLDR — the week in tech" },
				{ email: "crew@morningbrew.com", place: "filter", subject: "Morning Brew" },
				{
					email: "kale@hackernewsletter.com",
					place: "unsorted",
					subject: "Hacker Newsletter #700",
				},
			],
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the Gmail connection");

	await loginAs(page, email);
	await page.goto(`${BASE_URL}/integrations/gmail`, { waitUntil: "domcontentloaded" });
}

async function pickerIsRendered(page: Page): Promise<void> {
	await page.waitForSelector(SECTION);
	await page.waitForSelector(DESTINATION_SELECT);
	await waitForBrandFonts(page, ["Inter"]);
}

async function inboxPickerSitsBesideItsNameBoxBelowTheSender(page: Page): Promise<void> {
	const section = await measuredBox(page, SECTION);
	const sender = await measuredBox(page, SENDER_INPUT);
	const destination = await measuredBox(page, DESTINATION_SELECT);
	const inboxName = await measuredBox(page, INBOX_NAME_INPUT);

	assert.ok(
		destination.y >= sender.y + sender.height,
		"the inbox picker must sit below the sender address row, not beside it",
	);
	assert.equal(
		Math.round(destination.y),
		Math.round(inboxName.y),
		"the inbox select and its name box must share one row",
	);
	assert.equal(
		Math.round(destination.height),
		Math.round(inboxName.height),
		"the inbox select must stand the same height as the name box it sits beside",
	);
	for (const [name, part] of [
		["inbox select", destination],
		["inbox name box", inboxName],
	] as const) {
		assert.ok(
			part.x >= section.x && part.x + part.width <= section.x + section.width,
			`the ${name} must sit inside the forwarding section`,
		);
	}
}

const GMAIL_INBOXES_LIGHT: VisualCheckpoint = {
	name: "gmail-inboxes-light",
	settled: pickerIsRendered,
	geometry: inboxPickerSitsBesideItsNameBoxBelowTheSender,
	target: SECTION,
	capture: "element",
	pinnedText: [{ selector: MAPPED_ADDRESS, text: PINNED_MAPPED_ADDRESS }],
};

test.describe("Gmail named inboxes", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("offers an inbox for each newsletter beside the sender it forwards", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openForwardingInboxes(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, GMAIL_INBOXES_LIGHT);
	});
});
