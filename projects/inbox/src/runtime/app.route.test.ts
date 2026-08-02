import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
	CHANGELOG_DISMISS_COOKIE_NAME,
	type ChangelogBanner,
	isChangelogVersion,
} from "@packages/web-shell";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { buildHarness } from "@packages/web-test-harness";
import type { RunningServer } from "@packages/web-test-harness";
import { createInboxTestApp, loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const CHANGELOG_VERSION = "a1b2c3d4";
assert(isChangelogVersion(CHANGELOG_VERSION));
const CHANGELOG: ChangelogBanner = {
	hook: "I added keyboard shortcuts to the reader",
	href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
	version: CHANGELOG_VERSION,
};

describe("Inbox app composition", () => {
	it("serves nothing outside /inbox — the rest of the origin belongs to hutch", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/queue");

		expect(response.status).toBe(404);
	});

	it("resolves the hutch session cookie into an authenticated request", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/inbox");

		expect(response.status).toBe(200);
	});

	it("degrades to guest and logs when the session lookup fails, instead of 500ing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		fixture.auth.getSessionUserId = async () => {
			throw new Error("dynamo down");
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/inbox");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
		expect(errors.some((m) => m.includes("session lookup failed"))).toBe(true);
	});

	it("renders the announced changelog banner on an inbox page and suppresses it once dismissed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness: RunningServer & ReturnType<typeof createInboxTestApp> = buildHarness(
			createInboxTestApp(fixture, { getChangelogBanner: async () => CHANGELOG }),
		);
		try {
			const agent = await loginAgent(harness.server, harness.auth);

			const announced = await agent.get("/inbox");
			expect(announced.status).toBe(200);
			const banner = new JSDOM(announced.text).window.document.querySelector(
				"[data-test-changelog-banner]",
			);
			assert(banner, "the changelog banner shell must render");
			expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
			expect(banner.textContent).toContain(CHANGELOG.hook);

			const dismissed = await agent
				.get("/inbox")
				.set("Cookie", `${CHANGELOG_DISMISS_COOKIE_NAME}=${CHANGELOG_VERSION}`);
			expect(dismissed.status).toBe(200);
			const hiddenShell = new JSDOM(dismissed.text).window.document.querySelector(
				"[data-test-changelog-banner]",
			);
			assert(hiddenShell, "the dismissed banner keeps its hidden shell");
			expect(hiddenShell.classList.contains("changelog-banner--hidden")).toBe(true);
		} finally {
			await harness.close();
		}
	});

	it("consults the changelog source once via the pre-auth kick on a redirect that never renders the shell", async () => {
		let consultations = 0;
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness: RunningServer & ReturnType<typeof createInboxTestApp> = buildHarness(
			createInboxTestApp(fixture, {
				getChangelogBanner: async () => {
					consultations++;
					return undefined;
				},
			}),
		);
		try {
			const response = await request(harness.server).get("/inbox");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
			expect(consultations).toBe(1);
		} finally {
			await harness.close();
		}
	});
});
