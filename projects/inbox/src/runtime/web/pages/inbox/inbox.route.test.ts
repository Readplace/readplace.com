import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { AliasNameSchema, INBOX_ADDRESS_MAX_PER_USER } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { loginAgent, useTestServer } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	type TestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

function alertKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-inbox-alert]")).map((el) =>
		el.getAttribute("data-test-inbox-alert"),
	);
}

/** A fixture whose server clock runs `days` ahead of real time, so a freshly
 * created user lands past the 7-day verification window — i.e. locked — with no
 * way to backdate `registeredAt` directly. */
function fixtureClockedDaysAhead(days: number) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.shared.now = () => new Date(Date.now() + days * ONE_DAY_MS);
	return fixture;
}

function addressFieldValue(html: string): string | null | undefined {
	return new JSDOM(html).window.document
		.querySelector(".inbox-copyable__value")
		?.getAttribute("value");
}

const SEED_NAME = AliasNameSchema.parse("inbox");

/** Mints live addresses through the real store until the user sits exactly at the
 * per-user cap, so the next create is rejected the way production rejects it (the
 * in-memory fixture faithfully throws at the limit) instead of by stubbing the
 * throw. */
async function seedAddressesToCap(fixture: TestAppFixture, userId: UserId): Promise<void> {
	for (let i = 0; i < INBOX_ADDRESS_MAX_PER_USER; i++) {
		await fixture.inboxAddress.inboxAddressStore.createAddress({
			userId,
			domain: "read.place",
			name: SEED_NAME,
		});
	}
}

describe("Inbox address routes", () => {
	describe("GET /inbox/addresses (gating)", () => {
		it("redirects an unauthenticated visitor to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/inbox/addresses");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});

		it("renders the empty state with a create CTA when the user has no addresses", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const list = doc.querySelector("[data-test-inbox-list]");
			assert(list, "the address list must always render, hidden when empty");
			expect(list.getAttribute("data-test-inbox-addresses-state")).toBe("empty");
			assert(doc.querySelector("[data-test-inbox-empty]"), "the empty line must render");
			assert(doc.querySelector("[data-test-inbox-create]"), "the create form must render");
		});

		it("shows the limit banner proactively at the cap without the &error=limit param", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			await seedAddressesToCap(fixture, userId);

			const response = await agent.get("/inbox/addresses");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(alertKeys(doc)).toEqual(["limit"]);
		});

		it("shows the limit banner from the &error=limit flag even when the live count is below the cap", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses?error=limit");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(alertKeys(doc)).toEqual(["limit"]);
		});

		it("echoes the submitted name after a limit rejection without flagging the field", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses?error=limit&name=netflix");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(alertKeys(doc)).toEqual(["limit"]);
			const input = doc.querySelector("[data-test-inbox-name-input]");
			expect(input?.getAttribute("value")).toBe("netflix");
			expect(input?.getAttribute("aria-invalid")).toBe("false");
			expect(input?.hasAttribute("aria-describedby")).toBe(false);
			expect(input?.hasAttribute("autofocus")).toBe(false);
			expect(doc.querySelectorAll("#inbox-name-error")).toHaveLength(0);
		});
	});

	describe("POST /inbox/create", () => {
		it("creates a named address and surfaces it on the next visit to the addresses page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const created = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "Netflix" });
			expect(created.status).toBe(303);
			expect(created.headers.location).toBe("/inbox/addresses?created=netflix");

			const listed = await agent.get(created.headers.location);
			expect(addressFieldValue(listed.text)).toMatch(/^netflix-[0-9a-z]{6}@read\.place$/);
			const doc = new JSDOM(listed.text).window.document;
			expect(doc.querySelector("[data-test-inbox-name]")?.textContent).toBe("netflix");
			const confirmation = doc.querySelector("[data-test-inbox-created]");
			assert(confirmation, "the create confirmation must render on the redirect target");
			expect(confirmation.classList.contains("inbox__success--visible")).toBe(true);
			expect(confirmation.getAttribute("role")).toBe("status");
			expect(confirmation.textContent).toContain("netflix");
		});

		it("redirects with error=name when the submitted name has no valid characters", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "🎉🎉" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses?error=name");
			const listed = await agent.get("/inbox/addresses");
			expect(addressFieldValue(listed.text)).toBeUndefined();
		});

		it("redirects with error=name when the name field is missing entirely", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/inbox/create");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses?error=name");
		});

		it("surfaces the invalid-name alert on the redirect target, wired to the focused input", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const landing = await agent.get("/inbox/addresses?error=name");

			const doc = new JSDOM(landing.text).window.document;
			expect(alertKeys(doc)).toEqual(["name-invalid"]);
			const input = doc.querySelector("[data-test-inbox-name-input]");
			expect(input?.getAttribute("aria-invalid")).toBe("true");
			expect(input?.getAttribute("aria-describedby")).toBe("inbox-name-error");
			expect(input?.hasAttribute("autofocus")).toBe(true);
			expect(doc.getElementById("inbox-name-error")).toBe(
				doc.querySelector('[data-test-inbox-alert="name-invalid"]'),
			);
			expect(input?.getAttribute("value")).toBe("");
		});

		it("rejects a name the user already holds on a live address with error=name-taken", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });

			const dup = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "Netflix" });

			expect(dup.status).toBe(303);
			expect(dup.headers.location).toBe("/inbox/addresses?error=name-taken&name=netflix");
			const doc = new JSDOM((await agent.get(dup.headers.location)).text).window.document;
			expect(alertKeys(doc)).toEqual(["name-taken"]);
			const input = doc.querySelector("[data-test-inbox-name-input]");
			expect(input?.getAttribute("value")).toBe("netflix");
			expect(input?.getAttribute("aria-invalid")).toBe("true");
			expect(input?.getAttribute("aria-describedby")).toBe("inbox-name-error");
			expect(input?.hasAttribute("autofocus")).toBe(true);
			expect(doc.getElementById("inbox-name-error")?.textContent).toContain(
				"already have an active inbox email",
			);
			// Only the first address was minted — the duplicate did not create a second.
			expect(doc.querySelectorAll("[data-test-inbox-item]")).toHaveLength(1);
		});

		it("allows a second live address under a different name", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });

			const second = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "gmail" });

			expect(second.status).toBe(303);
			expect(second.headers.location).toBe("/inbox/addresses?created=gmail");
			const names = Array.from(
				new JSDOM(
					(await agent.get("/inbox/addresses")).text,
				).window.document.querySelectorAll("[data-test-inbox-name]"),
			).map((el) => el.textContent);
			expect(names).toEqual(["netflix", "gmail"]);
		});

		it("allows reusing the name of a disabled address, since the guard only blocks live ones", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });
			const first = addressFieldValue((await agent.get("/inbox/addresses")).text);
			await agent
				.post("/inbox/disable")
				.type("form")
				.send({ address: first ?? "" });

			const recreated = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "netflix" });

			expect(recreated.status).toBe(303);
			expect(recreated.headers.location).toBe("/inbox/addresses?created=netflix");
		});

		it("redirects a read-only user to /queue?inactive=1 and mints nothing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			await harness.subscriptionProviders.upsertTrialing({
				userId,
				trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
			});

			const response = await agent.post("/inbox/create").set("Accept", "text/html");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?inactive=1");
			const listed = await agent.get("/inbox/addresses");
			expect(addressFieldValue(listed.text)).toBeUndefined();
		});

		it("blocks a locked user with the account-locked screen and mints nothing", async () => {
			const harness = useApp(fixtureClockedDaysAhead(8));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/inbox/create").set("Accept", "text/html");

			expect(response.status).toBe(403);
			expect(
				new JSDOM(response.text).window.document.querySelector("h1")?.textContent,
			).toBe("Your account is locked");
			const listed = await agent.get("/inbox/addresses");
			expect(addressFieldValue(listed.text)).toBeUndefined();
		});

		it("surfaces the per-user limit message without logging an error when the cap is reached", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const errors: string[] = [];
			fixture.shared.logError = (message) => {
				errors.push(message);
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			await seedAddressesToCap(fixture, userId);

			// A fresh name (the seeded rows are all "inbox") so the cap — not the
			// duplicate-name guard — is what rejects this create.
			const response = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "overflow" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses?error=limit&name=overflow");
			expect(errors.some((m) => m.includes("[Inbox] Failed to create"))).toBe(false);

			const listed = await agent.get(response.headers.location);
			const doc = new JSDOM(listed.text).window.document;
			expect(alertKeys(doc)).toEqual(["limit"]);
			expect(doc.querySelector("[data-test-inbox-name-input]")?.getAttribute("value")).toBe(
				"overflow",
			);
		});

		it("keeps a single describedby target when the limit banner co-renders with the duplicate-name error", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			await seedAddressesToCap(fixture, userId);

			const dup = await agent.post("/inbox/create").type("form").send({ name: SEED_NAME });

			expect(dup.headers.location).toBe(`/inbox/addresses?error=name-taken&name=${SEED_NAME}`);
			const doc = new JSDOM((await agent.get(dup.headers.location)).text).window.document;
			expect(alertKeys(doc)).toEqual(["name-taken", "limit"]);
			expect(doc.querySelectorAll("#inbox-name-error")).toHaveLength(1);
			expect(
				doc.querySelector("[data-test-inbox-name-input]")?.getAttribute("aria-describedby"),
			).toBe("inbox-name-error");
		});

		it("redirects gracefully and logs when address creation fails", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const errors: string[] = [];
			fixture.shared.logError = (message) => {
				errors.push(message);
			};
			fixture.inboxAddress.inboxAddressStore.createAddress = async () => {
				throw new Error("dynamo down");
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "netflix" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses?error=create&name=netflix");
			expect(errors.some((m) => m.includes("[Inbox] Failed to create"))).toBe(true);
		});

		it("wraps a non-Error throw from the store so the log always carries an Error", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const loggedErrors: (Error | undefined)[] = [];
			fixture.shared.logError = (_message, error) => {
				loggedErrors.push(error);
			};
			fixture.inboxAddress.inboxAddressStore.createAddress = async () => {
				throw "dynamo down";
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "netflix" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses?error=create&name=netflix");
			expect(loggedErrors[0]).toBeInstanceOf(Error);
			expect(loggedErrors[0]?.message).toBe("dynamo down");
		});

		it("renders a graceful error indicator on the redirect target after a failed create", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.shared.logError = () => {};
			fixture.inboxAddress.inboxAddressStore.createAddress = async () => {
				throw new Error("dynamo down");
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const created = await agent
				.post("/inbox/create")
				.type("form")
				.send({ name: "netflix" });
			const landing = await agent.get(created.headers.location);

			expect(landing.status).toBe(200);
			const doc = new JSDOM(landing.text).window.document;
			expect(alertKeys(doc)).toEqual(["create-failed"]);
			const input = doc.querySelector("[data-test-inbox-name-input]");
			expect(input?.getAttribute("value")).toBe("netflix");
			expect(input?.getAttribute("aria-invalid")).toBe("false");
			expect(input?.hasAttribute("aria-describedby")).toBe(false);
		});

		it("renders no alert at all on a normal visit and leaves the field empty and unflagged", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses");

			const doc = new JSDOM(response.text).window.document;
			expect(alertKeys(doc)).toEqual([]);
			const input = doc.querySelector("[data-test-inbox-name-input]");
			expect(input?.getAttribute("value")).toBe("");
			expect(input?.getAttribute("aria-invalid")).toBe("false");
			expect(input?.hasAttribute("aria-describedby")).toBe(false);
			expect(input?.hasAttribute("autofocus")).toBe(false);
		});

		it("reflects only a valid alias from ?name=, dropping tampered input that normalizes to nothing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses?name=%F0%9F%8E%89");

			expect(response.status).toBe(200);
			const input = new JSDOM(response.text).window.document.querySelector(
				"[data-test-inbox-name-input]",
			);
			expect(input?.getAttribute("value")).toBe("");
		});

		it("renders the visible create confirmation on the redirect target", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses?created=netflix");

			const confirmation = new JSDOM(response.text).window.document.querySelector(
				"[data-test-inbox-created]",
			);
			assert(confirmation, "the create confirmation element must render");
			expect(confirmation.classList.contains("inbox__success--visible")).toBe(true);
			expect(confirmation.getAttribute("role")).toBe("status");
			expect(confirmation.textContent).toContain("netflix");
		});

		it("keeps the create confirmation hidden and empty on a normal visit", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses");

			const confirmation = new JSDOM(response.text).window.document.querySelector(
				"[data-test-inbox-created]",
			);
			assert(confirmation, "the create confirmation element must render");
			expect(confirmation.classList.contains("inbox__success--hidden")).toBe(true);
			expect(confirmation.textContent).toBe("");
		});

		it("keeps the create confirmation hidden when the created param is not a valid name", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses?created=NOT%20a%20name!");

			const confirmation = new JSDOM(response.text).window.document.querySelector(
				"[data-test-inbox-created]",
			);
			assert(confirmation, "the create confirmation element must render");
			expect(confirmation.classList.contains("inbox__success--hidden")).toBe(true);
		});
	});

	describe("POST /inbox/disable", () => {
		it("disables an address the user owns", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });
			const address = addressFieldValue(
				(await agent.get("/inbox/addresses")).text,
			);
			expect(address).not.toBeNull();

			const response = await agent
				.post("/inbox/disable")
				.type("form")
				.send({ address: address ?? "" });

			expect(response.status).toBe(303);
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			const statuses = Array.from(after.querySelectorAll("[data-test-inbox-status]")).map(
				(el) => el.getAttribute("data-test-inbox-status"),
			);
			expect(statuses).toEqual(["disabled"]);
			expect(after.querySelector(".inbox__disabled-summary")?.textContent).toBe(
				"Disabled inbox emails (1)",
			);
		});

		it("moves a disabled address into the collapsed group behind the remaining active ones", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });
			await agent.post("/inbox/create").type("form").send({ name: "gmail" });
			const netflixAddress = addressFieldValue(
				(await agent.get("/inbox/addresses")).text,
			);
			assert(netflixAddress, "the created netflix address must render");
			expect(netflixAddress).toMatch(/^netflix-/);

			await agent
				.post("/inbox/disable")
				.type("form")
				.send({ address: netflixAddress });

			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			const names = Array.from(after.querySelectorAll("[data-test-inbox-name]")).map(
				(el) => el.textContent,
			);
			expect(names).toEqual(["gmail", "netflix"]);
			expect(
				after.querySelector("[data-test-inbox-disabled-group] [data-test-inbox-name]")
					?.textContent,
			).toBe("netflix");
		});

		it("ignores a request whose body is not a valid address", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });

			const response = await agent
				.post("/inbox/disable")
				.type("form")
				.send({ address: "not-an-address" });

			expect(response.status).toBe(303);
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			expect(after.querySelector('[data-test-inbox-status="enabled"]')).not.toBeNull();
		});

		it("does not disable an address the user does not own", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });

			const response = await agent
				.post("/inbox/disable")
				.type("form")
				.send({ address: "in-zzzzzz@read.place" });

			expect(response.status).toBe(303);
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			expect(after.querySelector('[data-test-inbox-status="enabled"]')).not.toBeNull();
		});
	});

	describe("POST /inbox/enable", () => {
		it("re-enables a disabled address and returns it to the active list", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });
			const address = addressFieldValue((await agent.get("/inbox/addresses")).text);
			assert(address, "the created address must render");
			await agent.post("/inbox/disable").type("form").send({ address });

			const response = await agent.post("/inbox/enable").type("form").send({ address });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses");
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			const statuses = Array.from(after.querySelectorAll("[data-test-inbox-status]")).map(
				(el) => el.getAttribute("data-test-inbox-status"),
			);
			expect(statuses).toEqual(["enabled"]);
			expect(after.querySelector(".inbox__disabled-summary")?.textContent).toBe(
				"Disabled inbox emails (0)",
			);
			expect(
				after
					.querySelector("[data-test-inbox-disabled-group]")
					?.classList.contains("inbox__disabled-group--hidden"),
			).toBe(true);
		});

		it("renders an enable control on each disabled row pointing at the enable route", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });
			const address = addressFieldValue((await agent.get("/inbox/addresses")).text);
			assert(address, "the created address must render");
			await agent.post("/inbox/disable").type("form").send({ address });

			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			const enable = after.querySelector(
				"[data-test-inbox-disabled-group] [data-test-inbox-enable]",
			);
			assert(enable, "the disabled row must render an enable control");
			expect(enable.closest("form")?.getAttribute("action")).toBe("/inbox/enable");
		});

		it("leaves an already-live address unchanged and issues no error param", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });
			const address = addressFieldValue((await agent.get("/inbox/addresses")).text);
			assert(address, "the created address must render");

			const response = await agent.post("/inbox/enable").type("form").send({ address });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses");
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			const statuses = Array.from(after.querySelectorAll("[data-test-inbox-status]")).map(
				(el) => el.getAttribute("data-test-inbox-status"),
			);
			expect(statuses).toEqual(["enabled"]);
		});

		it("ignores a request whose body is not a valid address", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });

			const response = await agent
				.post("/inbox/enable")
				.type("form")
				.send({ address: "not-an-address" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses");
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			expect(after.querySelector('[data-test-inbox-status="enabled"]')).not.toBeNull();
		});

		it("does not enable an address the user does not own", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });

			const response = await agent
				.post("/inbox/enable")
				.type("form")
				.send({ address: "in-zzzzzz@read.place" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses");
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			const statuses = Array.from(after.querySelectorAll("[data-test-inbox-status]")).map(
				(el) => el.getAttribute("data-test-inbox-status"),
			);
			expect(statuses).toEqual(["enabled"]);
		});

		it("refuses to enable when it would exceed the cap, leaving the row disabled", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			const store = fixture.inboxAddress.inboxAddressStore;
			for (let i = 0; i < INBOX_ADDRESS_MAX_PER_USER - 1; i++) {
				await store.createAddress({ userId, domain: "read.place", name: SEED_NAME });
			}
			const target = await store.createAddress({
				userId,
				domain: "read.place",
				name: SEED_NAME,
			});
			await store.disableAddress({ userId, address: target.address });
			await store.createAddress({ userId, domain: "read.place", name: SEED_NAME });

			const response = await agent
				.post("/inbox/enable")
				.type("form")
				.send({ address: target.address });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses?error=limit");
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			const disabledField = after.querySelector(
				"[data-test-inbox-disabled-group] .inbox__address-field",
			);
			expect(disabledField?.getAttribute("value")).toBe(target.address);
		});

		it("redirects a read-only user to /queue?inactive=1 and re-enables nothing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			await agent.post("/inbox/create").type("form").send({ name: "netflix" });
			const address = addressFieldValue((await agent.get("/inbox/addresses")).text);
			assert(address, "the created address must render");
			await agent.post("/inbox/disable").type("form").send({ address });
			await harness.subscriptionProviders.upsertTrialing({
				userId,
				trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
			});

			const response = await agent
				.post("/inbox/enable")
				.type("form")
				.send({ address })
				.set("Accept", "text/html");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?inactive=1");
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			expect(after.querySelector('[data-test-inbox-status="disabled"]')).not.toBeNull();
			expect(after.querySelector('[data-test-inbox-status="enabled"]')).toBeNull();
		});

		it("blocks a locked user with the account-locked screen and re-enables nothing", async () => {
			const fixture = fixtureClockedDaysAhead(8);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			const store = fixture.inboxAddress.inboxAddressStore;
			const entry = await store.createAddress({
				userId,
				domain: "read.place",
				name: SEED_NAME,
			});
			await store.disableAddress({ userId, address: entry.address });

			const response = await agent
				.post("/inbox/enable")
				.type("form")
				.send({ address: entry.address })
				.set("Accept", "text/html");

			expect(response.status).toBe(403);
			expect(
				new JSDOM(response.text).window.document.querySelector("h1")?.textContent,
			).toBe("Your account is locked");
			const after = new JSDOM(
				(await agent.get("/inbox/addresses")).text,
			).window.document;
			expect(after.querySelector('[data-test-inbox-status="disabled"]')).not.toBeNull();
		});
	});
});
