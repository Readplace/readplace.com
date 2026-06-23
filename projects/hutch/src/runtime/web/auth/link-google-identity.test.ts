import { UserIdSchema } from "@packages/domain/user";
import { linkVerifiedGoogleIdentity } from "./link-google-identity";
import type { LinkGoogleIdentityDeps } from "./link-google-identity";

function recordingDeps(): LinkGoogleIdentityDeps & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		clearPasswordHash: async (email) => {
			calls.push(`clear:${email}`);
		},
		destroyUserSessions: async (userId) => {
			calls.push(`destroy:${userId}`);
		},
		markEmailVerified: async (email) => {
			calls.push(`verify:${email}`);
		},
		createSession: async ({ userId, emailVerified }) => {
			calls.push(`session:${userId}:${emailVerified}`);
			return "sess-1";
		},
	};
}

describe("linkVerifiedGoogleIdentity", () => {
	it("links a verified account without touching its password or sessions", async () => {
		const deps = recordingDeps();

		const sessionId = await linkVerifiedGoogleIdentity(deps, {
			userId: UserIdSchema.parse("u1"),
			email: "owner@gmail.com",
			emailVerified: true,
			hasPassword: true,
		});

		expect(sessionId).toBe("sess-1");
		expect(deps.calls).toEqual(["session:u1:true"]);
	});

	it("clears the unproven password and sessions before linking an unverified account", async () => {
		const deps = recordingDeps();

		const sessionId = await linkVerifiedGoogleIdentity(deps, {
			userId: UserIdSchema.parse("u2"),
			email: "john.doe@gmail.com",
			emailVerified: false,
			hasPassword: true,
		});

		expect(sessionId).toBe("sess-1");
		expect(deps.calls).toEqual([
			"clear:john.doe@gmail.com",
			"destroy:u2",
			"verify:john.doe@gmail.com",
			"session:u2:true",
		]);
	});
});
