import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const READER_EMAIL = "alex+notes@example.com";
const READER_PASSWORD = "password456";
const NOW = new Date("2026-11-10T22:00:00.000Z");
const SIGNUP_AT_TEN = "2026-11-01";
const TRIAL_ENDS_AT = "2026-11-15T10:00:00.000Z";

const useApp = useTestServer();

function doc(html: string) {
	return new JSDOM(html).window.document;
}

async function harnessAt(now: Date = NOW) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.shared.now = () => now;
	const harness = useApp({
		...fixture,
		admin: { adminEmails: [ADMIN_EMAIL], recrawlServiceToken: fixture.admin.recrawlServiceToken },
	});
	await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
	await harness.auth.createUser({ email: READER_EMAIL, password: READER_PASSWORD });
	const reader = await harness.auth.findUserByEmail(READER_EMAIL);
	assert(reader, "the reader must exist once created");
	const admin = request.agent(harness.server);
	await admin.post("/login").type("form").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
	return { harness, admin, userId: reader.userId };
}

async function trialingHarness(now: Date = NOW) {
	const subject = await harnessAt(now);
	await subject.harness.subscriptionProviders.upsertTrialing({ userId: subject.userId, trialEndsAt: TRIAL_ENDS_AT });
	return subject;
}

type Subject = Awaited<ReturnType<typeof harnessAt>>;

function postNote(subject: Subject, form: Record<string, string>) {
	return subject.admin.post("/admin/founder-notes").type("form").send(form);
}

function lifecycleEvents(subject: Subject) {
	return subject.harness.funnelEvents.events.filter((event) => event.event === "lifecycle_email_sent");
}

async function founderNoteSentAt(subject: Subject) {
	return (await subject.harness.subscriptionProviders.findByUserId(subject.userId))?.founderNoteSentAt;
}

function selectedNote(html: string) {
	return doc(html).querySelector<HTMLSelectElement>("[data-test-founder-note-kind]")?.value;
}

function errorText(html: string, field: string) {
	return doc(html).querySelector(`[data-test-error="${field}"]`)?.textContent;
}

function alertText(html: string) {
	return doc(html).querySelector('[data-test-alert="founder-notes"] [data-test-alert-title]')?.textContent;
}

describe("Admin founder-notes routes", () => {
	describe("authorization", () => {
		it("forbids a signed-in reader who is not an admin, and records nothing", async () => {
			const subject = await trialingHarness();
			const reader = request.agent(subject.harness.server);
			await reader.post("/login").type("form").send({ email: READER_EMAIL, password: READER_PASSWORD });

			const page = await reader.get("/admin/founder-notes");
			const post = await reader.post("/admin/founder-notes").type("form").send({ email: READER_EMAIL, note: "day-1" });

			expect(page.status).toBe(403);
			expect(post.status).toBe(403);
			assert.equal(await founderNoteSentAt(subject), undefined);
		});
	});

	describe("the form", () => {
		it("offers the email, the note and a date, posting to a tracked action", async () => {
			const subject = await harnessAt();

			const response = await subject.admin.get("/admin/founder-notes");

			expect(response.status).toBe(200);
			const form = doc(response.text).querySelector<HTMLFormElement>("[data-test-founder-notes-form]");
			assert(form, "the form must render");
			const action = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
			expect(action.pathname).toBe("/admin/founder-notes");
			expect(action.searchParams.get("utm_source")).toBe("admin-founder-notes");
			expect(action.searchParams.get("utm_content")).toBe("record-note");
			expect(form.getAttribute("method")).toBe("POST");
			expect(Array.from(form.querySelectorAll("option")).map((option) => option.value)).toEqual(["day-1", "day-12"]);
			expect(form.querySelector('input[name="sentAt"]')?.getAttribute("type")).toBe("date");
			expect(doc(response.text).querySelectorAll('[data-test-alert="founder-notes"]').length).toBe(0);
		});

		it.each([
			["an email alone", "/admin/founder-notes?email=reader%40example.com"],
			["recorded=1 with no email", "/admin/founder-notes?recorded=1"],
		])("names no recording for %s", async (_name, path) => {
			const subject = await harnessAt();

			const response = await subject.admin.get(path);

			expect(response.status).toBe(200);
			expect(doc(response.text).querySelectorAll('[data-test-alert="founder-notes"]').length).toBe(0);
		});
	});

	describe("recording a note", () => {
		it("sets the marker, records the event and shows who it was recorded for", async () => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-1", sentAt: "2026-11-03" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/admin/founder-notes?email=${encodeURIComponent(READER_EMAIL)}&recorded=1`);
			assert.equal(await founderNoteSentAt(subject), "2026-11-03T00:00:00.000Z");
			assert.deepEqual(lifecycleEvents(subject), [
				{
					stream: "analytics",
					event: "lifecycle_email_sent",
					timestamp: NOW.toISOString(),
					user_id: subject.userId,
					kind: "founder-note-day1",
					trial_day: 3,
					utm_source: "founder-note",
					delivery: "founder-manual",
				},
			]);

			const page = await subject.admin.get(response.headers.location);

			expect(alertText(page.text)).toBe(`Recorded for ${READER_EMAIL}.`);
		});

		it("records the day-12 kind", async () => {
			const subject = await trialingHarness();

			await postNote(subject, { email: READER_EMAIL, note: "day-12", sentAt: "2026-11-10" });

			assert.equal(lifecycleEvents(subject)[0]?.kind, "founder-note-day12");
		});

		it.each([
			["an omitted date", {}],
			["an empty date", { sentAt: "" }],
		])("records today at UTC midnight for %s", async (_name, extra) => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-1", ...extra });

			expect(response.status).toBe(303);
			assert.equal(await founderNoteSentAt(subject), "2026-11-10T00:00:00.000Z");
		});

		it("reads a note dated the signup's UTC day as trial day 1, though that day's midnight falls before the signup", async () => {
			const subject = await trialingHarness();

			await postNote(subject, { email: READER_EMAIL, note: "day-1", sentAt: SIGNUP_AT_TEN });

			assert.equal(lifecycleEvents(subject)[0]?.trial_day, 1);
		});

		it("records no trial day for a row with no trial end, and still sets the marker", async () => {
			const subject = await harnessAt();
			await subject.harness.subscriptionProviders.upsertActive({
				userId: subject.userId,
				subscriptionId: "sub_notes",
				customerId: "cus_notes",
			});

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-12", sentAt: "2026-11-09" });

			expect(response.status).toBe(303);
			assert.equal(await founderNoteSentAt(subject), "2026-11-09T00:00:00.000Z");
			assert.equal(lifecycleEvents(subject)[0]?.trial_day, null);
		});
	});

	describe("refusals", () => {
		it("answers an unknown email with a 422 and writes nothing", async () => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: "nobody@example.com", note: "day-1" });

			expect(response.status).toBe(422);
			expect(alertText(response.text)).toBe("No account with that email.");
			assert.equal(await founderNoteSentAt(subject), undefined);
			assert.deepEqual(lifecycleEvents(subject), []);
		});

		it("answers an account with no subscription row with a 422 and records nothing", async () => {
			const subject = await harnessAt();

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-1" });

			expect(response.status).toBe(422);
			expect(alertText(response.text)).toBe(`No subscription row for ${READER_EMAIL}.`);
			assert.deepEqual(lifecycleEvents(subject), []);
		});

		it("re-renders an invalid note kind with what the founder typed", async () => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-30", sentAt: "2026-11-03" });

			expect(response.status).toBe(422);
			expect(errorText(response.text, "note")).toBe("Choose which note you sent");
			const form = doc(response.text);
			expect(form.querySelector<HTMLInputElement>('input[name="email"]')?.value).toBe(READER_EMAIL);
			expect(form.querySelector<HTMLInputElement>('input[name="sentAt"]')?.value).toBe("2026-11-03");
			assert.equal(await founderNoteSentAt(subject), undefined);
		});

		it("keeps the chosen note when the date is what got refused", async () => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-12", sentAt: "nope" });

			expect(response.status).toBe(422);
			expect(selectedNote(response.text)).toBe("day-12");
		});

		it("refuses an invalid email", async () => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: "not-an-email", note: "day-1" });

			expect(response.status).toBe(422);
			expect(errorText(response.text, "email")).toBe("Enter a valid email address");
		});

		it("refuses a post with no body at all, with the form re-rendered", async () => {
			const subject = await trialingHarness();

			const response = await subject.admin.post("/admin/founder-notes");

			expect(response.status).toBe(422);
			expect(errorText(response.text, "email")).toBe("Enter a valid email address");
			expect(errorText(response.text, "note")).toBe("Choose which note you sent");
		});

		it.each(["nope", "2026-02-31", "2026-13-01", "2026-1-5"])("refuses %s as a date and writes nothing", async (sentAt) => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-1", sentAt });

			expect(response.status).toBe(422);
			expect(errorText(response.text, "sentAt")).toBe("Choose a valid date");
			assert.equal(await founderNoteSentAt(subject), undefined);
			assert.deepEqual(lifecycleEvents(subject), []);
		});
	});

	describe("the latest date a note can carry", () => {
		it("takes the next UTC day at 22:00 UTC, because that is already today in Melbourne", async () => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-1", sentAt: "2026-11-11" });

			expect(response.status).toBe(303);
			assert.equal(await founderNoteSentAt(subject), "2026-11-11T00:00:00.000Z");
		});

		it("refuses the day after that and writes nothing", async () => {
			const subject = await trialingHarness();

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-1", sentAt: "2026-11-12" });

			expect(response.status).toBe(422);
			expect(errorText(response.text, "sentAt")).toBe("Choose a date no later than 2026-11-11");
			assert.equal(await founderNoteSentAt(subject), undefined);
		});

		it("refuses the next UTC day at 05:00 UTC, when it is not yet that day anywhere the founder writes from", async () => {
			const subject = await trialingHarness(new Date("2026-11-10T05:00:00.000Z"));

			const response = await postNote(subject, { email: READER_EMAIL, note: "day-1", sentAt: "2026-11-11" });

			expect(response.status).toBe(422);
		});
	});
});
