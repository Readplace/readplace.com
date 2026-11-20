import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { type TestAppHarness, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { DELETE_ACCOUNT_CONFIRMATION_PHRASE } from "../account/account.view-model";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";

const useApp = useTestServer();
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "password123";

async function createReader(harness: TestAppHarness, email: string): Promise<UserId> {
	const created = await harness.auth.createUser({ email, password: PASSWORD });
	assert(created.ok, "user should be created");
	return created.userId;
}

async function signIn(harness: TestAppHarness, email: string) {
	const agent = request.agent(harness.server).set("User-Agent", BROWSER_USER_AGENT);
	await agent.post("/login").type("form").send({ email, password: PASSWORD });
	return agent;
}

function reportAgeRange(harness: TestAppHarness, params: { token: string; ageRange: string; parentalApproval: string }) {
	return request(harness.server)
		.post("/queue/age-range")
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.type("form")
		.send({ ageRange: params.ageRange, parentalApproval: params.parentalApproval });
}

async function lockAsUnder13(harness: TestAppHarness, email: string): Promise<{ userId: UserId; unlockToken: string }> {
	const userId = await createReader(harness, email);
	const token = await saveAccessTokenForUser(harness, userId);
	const response = await reportAgeRange(harness, { token, ageRange: "under-13", parentalApproval: "none-reported" });
	assert.equal(response.status, 403);
	const lockEmail = harness.email.getSentEmails().find((sent) => sent.to === email);
	assert(lockEmail, "the lock email must be sent");
	const match = /token&#x3D;([a-f0-9]+)/.exec(lockEmail.html);
	assert(match?.[1], "the lock email must carry an unlock token");
	return { userId, unlockToken: match[1] };
}

function document(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("POST /queue/age-range", () => {
	it("answers 204 and changes nothing for a reader 13 or over", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await createReader(harness, "teen@example.com");
		const token = await saveAccessTokenForUser(harness, userId);

		const response = await reportAgeRange(harness, { token, ageRange: "13-15", parentalApproval: "approved" });

		expect(response.status).toBe(204);
		expect(await harness.oauthModel.getAccessToken(token)).toBeTruthy();
		expect(harness.trialScheduler.getAgeLockDeletionSchedule(userId)).toBeUndefined();
	});

	it("refuses an age range it does not recognise with 400", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await createReader(harness, "odd@example.com");
		const token = await saveAccessTokenForUser(harness, userId);

		const response = await reportAgeRange(harness, { token, ageRange: "12", parentalApproval: "none-reported" });

		expect(response.status).toBe(400);
		expect(response.body.properties.code).toBe("invalid-age-range");
	});

	it("answers 401 without a signed-in reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/age-range")
			.set("Accept", SIREN_MEDIA_TYPE)
			.type("form")
			.send({ ageRange: "18-plus", parentalApproval: "none-reported" });

		expect(response.status).toBe(401);
	});

	it("revokes the reporting app's tokens and answers 403 without locking a minor whose parental approval is withheld", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await createReader(harness, "minor@example.com");
		const token = await saveAccessTokenForUser(harness, userId);

		const response = await reportAgeRange(harness, { token, ageRange: "16-17", parentalApproval: "denied" });

		expect(response.status).toBe(403);
		expect(response.body.class).toContain("error");
		expect(await harness.oauthModel.getAccessToken(token)).toBeFalsy();
		expect(harness.trialScheduler.getAgeLockDeletionSchedule(userId)).toBeUndefined();
		expect(harness.email.getSentEmails().filter((sent) => sent.to === "minor@example.com")).toEqual([]);
	});

	it("pauses an under-13 account: revokes every token, schedules deletion in 30 days and emails the unlock link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await createReader(harness, "child@example.com");
		const token = await saveAccessTokenForUser(harness, userId);
		const before = Date.now();

		const response = await reportAgeRange(harness, { token, ageRange: "under-13", parentalApproval: "none-reported" });

		expect(response.status).toBe(403);
		expect(await harness.oauthModel.getAccessToken(token)).toBeFalsy();
		const firesAt = harness.trialScheduler.getAgeLockDeletionSchedule(userId);
		assert(firesAt, "a deletion schedule must be created");
		expect(Date.parse(firesAt) - before).toBeGreaterThanOrEqual(30 * DAY_MS - 1000);
		expect(Date.parse(firesAt) - before).toBeLessThanOrEqual(30 * DAY_MS + 60_000);
		const user = await harness.auth.findUserById(userId);
		expect(user?.ageLockedAt).toBeDefined();
		const lockEmail = harness.email.getSentEmails().find((sent) => sent.to === "child@example.com");
		expect(lockEmail?.html).toContain("/account/age-unlock?token&#x3D;");
	});

	it("still takes a report from an account locked for an unverified email", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * DAY_MS);
		const harness = useApp(fixture);
		const userId = await createReader(harness, "unverified@example.com");
		const token = await saveAccessTokenForUser(harness, userId);

		const response = await reportAgeRange(harness, { token, ageRange: "18-plus", parentalApproval: "none-reported" });

		expect(response.status).toBe(204);
	});
});

describe("a paused account", () => {
	it("shows the paused page on a web page and refuses a native request with a Siren 403", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await lockAsUnder13(harness, "paused@example.com");
		const agent = await signIn(harness, "paused@example.com");

		const page = await agent.get("/queue");
		const siren = await agent.get("/queue").set("Accept", SIREN_MEDIA_TYPE);

		expect(page.status).toBe(403);
		expect(document(page.text).querySelector("[data-test-age-paused]")).not.toBeNull();
		expect(siren.status).toBe(403);
		expect(siren.body.class).toContain("error");
	});

	it("can still export its data and sign out", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await lockAsUnder13(harness, "leaving@example.com");
		const agent = await signIn(harness, "leaving@example.com");

		const exported = await agent.get("/export");
		const loggedOut = await agent.post("/logout").redirects(0);

		expect(exported.status).not.toBe(403);
		expect(loggedOut.status).toBe(303);
	});

	it("can still delete itself", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { userId } = await lockAsUnder13(harness, "deleting@example.com");
		const agent = await signIn(harness, "deleting@example.com");
		const paused = document((await agent.get("/queue")).text);
		const form = paused.querySelector<HTMLFormElement>("[data-test-age-paused] form[action='/account/delete']");
		assert(form, "the paused page must offer deletion");
		const confirmation = form.querySelector<HTMLInputElement>("input[name]");
		assert(confirmation, "the deletion form must ask for the confirmation phrase");

		const response = await agent
			.post("/account/delete")
			.type("form")
			.send({ [confirmation.name]: DELETE_ACCOUNT_CONFIRMATION_PHRASE })
			.redirects(0);

		expect(response.status).not.toBe(403);
		expect((await harness.auth.findUserById(userId))?.deletedAt).toBeDefined();
	});
});

describe("/account/age-unlock", () => {
	it("asks the holder to confirm before unlocking", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { unlockToken } = await lockAsUnder13(harness, "confirm@example.com");

		const response = await request(harness.server).get(`/account/age-unlock?token=${unlockToken}`);

		expect(response.status).toBe(200);
		const form = document(response.text).querySelector("[data-test-age-unlock] form");
		expect(form?.querySelector<HTMLInputElement>("input[name='token']")?.value).toBe(unlockToken);
	});

	it("shows the invalid page for a link without a token", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/account/age-unlock");

		expect(response.status).toBe(400);
	});

	it("clears the lock and cancels the deletion, and refuses the same link a second time", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { userId, unlockToken } = await lockAsUnder13(harness, "unlock@example.com");

		const first = await request(harness.server).post("/account/age-unlock").type("form").send({ token: unlockToken });
		const second = await request(harness.server).post("/account/age-unlock").type("form").send({ token: unlockToken });

		expect(first.status).toBe(200);
		expect((await harness.auth.findUserById(userId))?.ageLockedAt).toBeUndefined();
		expect(harness.trialScheduler.getAgeLockDeletionSchedule(userId)).toBeUndefined();
		expect(harness.trialScheduler.ageLockDeletionDeleteCalls()).toContain(userId);
		expect(second.status).toBe(400);
		const agent = await signIn(harness, "unlock@example.com");
		expect((await agent.get("/queue")).status).toBe(200);
	});
});
