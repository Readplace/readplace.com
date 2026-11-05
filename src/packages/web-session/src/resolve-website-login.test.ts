import { authenticatedUserIdFrom } from "@packages/domain/user";
import { noopLogger, type Logger } from "@packages/logger";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initResolveWebsiteLogin } from "./resolve-website-login";

function createFakeClient(send: () => Promise<unknown>): DynamoDBDocumentClient {
	const client: Partial<DynamoDBDocumentClient> = {
		send: send as DynamoDBDocumentClient["send"],
	};
	return client as DynamoDBDocumentClient;
}

function resolverWith(send: () => Promise<unknown>) {
	const journal: Record<string, unknown>[] = [];
	const errors: unknown[][] = [];
	const capture = (event: Record<string, unknown>) => { journal.push(event); };
	const logger: Logger = {
		...noopLogger,
		error: (...args: unknown[]) => errors.push(args),
	};
	const resolveLogin = initResolveWebsiteLogin({
		client: createFakeClient(send),
		sessionsTableName: "sessions",
		salt: "test-salt",
		now: () => new Date(),
		logger,
		journalLogger: { info: capture, error: capture, warn: capture, debug: capture },
	});
	return { resolveLogin, journal, errors };
}

const FUTURE = Math.floor(Date.now() / 1000) + 3600;

describe("initResolveWebsiteLogin", () => {
	it("resolves a live session cookie to the signed-in login state", async () => {
		const { resolveLogin } = resolverWith(async () => ({
			Item: { sessionId: "sid", userId: "user-1", expiresAt: FUTURE, emailVerified: true },
		}));

		expect(await resolveLogin("hutch_sid=sid")).toEqual({
			isAuthenticated: true,
			userId: authenticatedUserIdFrom("user-1"),
			emailVerified: true,
			sessionExpiresAt: FUTURE,
		});
	});

	it("resolves to guest when no session cookie is present", async () => {
		const { resolveLogin } = resolverWith(async () => {
			throw new Error("must not be called");
		});

		expect(await resolveLogin("theme=dark")).toEqual({ isAuthenticated: false });
	});

	it("degrades to guest and journals the lookup failure with the website context", async () => {
		const { resolveLogin, journal, errors } = resolverWith(async () => {
			throw new Error("boom");
		});

		expect(await resolveLogin("hutch_sid=sid")).toEqual({ isAuthenticated: false });
		expect(errors).toHaveLength(1);
		expect(errors[0][0]).toBe("[web-session] session lookup failed; resolving as guest");
		expect(journal).toEqual([
			expect.objectContaining({
				client: "web",
				surface: "website",
				stream: "auth-diagnostics",
				event: "session_unavailable",
				reason: "lookup_error",
			}),
		]);
	});
});
