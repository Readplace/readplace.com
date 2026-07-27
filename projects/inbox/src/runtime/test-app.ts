import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { Express } from "express";
import request from "supertest";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type {
	AuthBundle,
	RunningServer,
	SubscriptionProvidersBundle,
	TestAppFixture,
} from "@packages/web-test-harness";
import { useTestServer as useServerForFixture } from "@packages/web-test-harness";
import { initResolveLogin, SESSION_COOKIE_NAME } from "@packages/web-session";
import { createInboxApp } from "./app";
import type { GetChangelogBanner } from "./web/changelog-banner-source";

export interface TestAppResult {
	app: Express;
	auth: AuthBundle;
	subscriptionProviders: SubscriptionProvidersBundle;
	submittedLinks: Array<{ userId: string; url: string }>;
}

/** Fixed CDN origin the test app pins into the email iframe's CSP, exported so
 * route tests assert the exact policy the app would emit. */
export const TEST_IMAGES_CDN_BASE_URL = "https://cdn.test.readplace.com";

/** `overrides` lets a test swap a single dependency without rebuilding the whole
 * fixture — `getChangelogBanner` defaults to "no banner" so it stays hidden in
 * every other route test. */
export function createInboxTestApp(
	fixture: TestAppFixture,
	overrides?: {
		getChangelogBanner?: GetChangelogBanner;
		publishSubmitLink?: (input: { userId: string; url: string }) => Promise<void>;
	},
): TestAppResult {
	const resolveLogin = initResolveLogin({
		getSessionUserId: fixture.auth.getSessionUserId,
		logger: HutchLogger.from({
			...noopLogger,
			error: (...args) => fixture.shared.logError(String(args[0])),
		}),
	});
	const submittedLinks: Array<{ userId: string; url: string }> = [];
	const app = createInboxApp(
		{
			inboxAddressDomain: fixture.inboxAddress.inboxAddressDomain,
			imagesCdnBaseUrl: TEST_IMAGES_CDN_BASE_URL,
		},
		{
			resolveLogin,
			findUserById: fixture.auth.findUserById,
			markSessionEmailVerified: fixture.auth.markSessionEmailVerified,
			findSubscriptionByUserId: fixture.subscriptionProviders.findByUserId,
			getChangelogBanner: overrides?.getChangelogBanner ?? (async () => undefined),
			inboxAddressStore: fixture.inboxAddress.inboxAddressStore,
			inboxEmailStore: fixture.inboxEmail.inboxEmailStore,
			inboxEmailLinkStore: fixture.inboxEmail.inboxEmailLinkStore,
			inboxSavedLinkStore: fixture.inboxEmail.inboxSavedLinkStore,
			readEmailContent: fixture.inboxEmail.readEmailContent,
			publishSubmitLink: async (input) => {
				submittedLinks.push(input);
				// The e2e server stands in for the deployed round trip so the Saved
				// chip can appear; route tests leave it recording-only.
				await overrides?.publishSubmitLink?.(input);
			},
			logError: fixture.shared.logError,
			now: fixture.shared.now,
		},
	);
	return {
		app,
		auth: fixture.auth,
		subscriptionProviders: fixture.subscriptionProviders,
		submittedLinks,
	};
}

export interface TestAppHarness extends TestAppResult, RunningServer {}

export function useTestServer(overrides?: {
	getChangelogBanner?: GetChangelogBanner;
	publishSubmitLink?: (input: { userId: string; url: string }) => Promise<void>;
}): (fixture: TestAppFixture) => TestAppHarness {
	return useServerForFixture((fixture) => createInboxTestApp(fixture, overrides));
}

/** Logs a fresh user in without a /login route: this deployable never mounts
 * one (hutch owns it on the same origin), so the harness mints the session
 * directly and seeds the cookie into the agent's jar — the same cookie a hutch
 * login would have set. The session carries the user's real (unverified)
 * standing, mirroring what hutch stores at login, so verification gates behave
 * exactly as they would after a production sign-in. */
export async function loginAgent(
	server: Server,
	auth: Pick<AuthBundle, "createUser" | "createSession">,
): Promise<ReturnType<typeof request.agent>> {
	const created = await auth.createUser({
		email: "test@example.com",
		password: "password123",
	});
	assert(created.ok, "loginAgent must create a fresh user");
	const sessionId = await auth.createSession({
		userId: created.userId,
		emailVerified: false,
	});
	const agent = request.agent(server);
	// supertest addresses the wrapped server as http://127.0.0.1:<port>, so the
	// cookie is pinned to that host for the jar's domain match.
	agent.jar.setCookie(`${SESSION_COOKIE_NAME}=${sessionId}; Path=/`, "127.0.0.1", "/");
	return agent;
}
