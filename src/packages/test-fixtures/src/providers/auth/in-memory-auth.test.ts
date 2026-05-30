import assert from "node:assert/strict";
import type { UserId } from "@packages/domain/user";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryAuth } from "./in-memory-auth";
import { hashPassword, verifyPassword } from "./password";

const makeAuth = () => initInMemoryAuth({ hashPassword, verifyPassword });

describe("initInMemoryAuth", () => {
	describe("createUser", () => {
		it("should create a user and return a userId", async () => {
			const auth = makeAuth();
			const result = await auth.createUser({ email: "test@example.com", password: "password123" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(typeof result.userId).toBe("string");
				expect(result.userId.length).toBeGreaterThan(0);
			}
		});

		it("should reject duplicate email", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "test@example.com", password: "password123" });
			const result = await auth.createUser({ email: "test@example.com", password: "otherpassword" });

			expect(result).toEqual({ ok: false, reason: "email-already-exists" });
		});

		it("should treat emails as case-insensitive", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "Test@Example.COM", password: "password123" });
			const result = await auth.createUser({ email: "test@example.com", password: "otherpassword" });

			expect(result).toEqual({ ok: false, reason: "email-already-exists" });
		});

		it("should trim whitespace from emails", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "  test@example.com  ", password: "password123" });
			const result = await auth.createUser({ email: "test@example.com", password: "otherpassword" });

			expect(result).toEqual({ ok: false, reason: "email-already-exists" });
		});

		it("should treat plus aliases as separate users", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "user@example.com", password: "password123" });
			const result = await auth.createUser({ email: "user+tag@example.com", password: "password456" });

			expect(result.ok).toBe(true);
		});
	});

	describe("verifyCredentials", () => {
		it("should verify correct password", async () => {
			const auth = makeAuth();
			const createResult = await auth.createUser({ email: "test@example.com", password: "password123" });
			if (!createResult.ok) throw new Error("User creation failed");

			const result = await auth.verifyCredentials({ email: "test@example.com", password: "password123" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.userId).toBe(createResult.userId);
			}
		});

		it("should reject wrong password", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const result = await auth.verifyCredentials({ email: "test@example.com", password: "wrongpassword" });

			expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
		});

		it("should reject nonexistent email", async () => {
			const auth = makeAuth();

			const result = await auth.verifyCredentials({ email: "noone@example.com", password: "password123" });

			expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
		});

		it("should not match plus alias against base email", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "user@example.com", password: "password123" });

			const result = await auth.verifyCredentials({ email: "user+tag@example.com", password: "password123" });

			expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
		});

		it("should verify with case-insensitive email", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const result = await auth.verifyCredentials({ email: "TEST@Example.COM", password: "password123" });

			expect(result.ok).toBe(true);
		});
	});

	describe("countUsers", () => {
		it("should return zero when no users exist", async () => {
			const auth = makeAuth();

			const count = await auth.countUsers();

			expect(count).toBe(0);
		});

		it("should return the number of registered users", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "a@example.com", password: "password123" });
			await auth.createUser({ email: "b@example.com", password: "password456" });

			const count = await auth.countUsers();

			expect(count).toBe(2);
		});
	});

	describe("markEmailVerified", () => {
		it("should mark user email as verified", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "user@example.com", password: "password123" });

			await auth.markEmailVerified("user@example.com");
			const result = await auth.verifyCredentials({ email: "user@example.com", password: "password123" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.emailVerified).toBe(true);
			}
		});

		it("should handle case-insensitive email lookup", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "user@example.com", password: "password123" });

			await auth.markEmailVerified("User@Example.COM");
			const result = await auth.verifyCredentials({ email: "user@example.com", password: "password123" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.emailVerified).toBe(true);
			}
		});
	});

	describe("markSessionEmailVerified", () => {
		it("should mark session emailVerified flag to true", async () => {
			const auth = makeAuth();
			const userId = "user-456" as UserId;
			const sessionId = await auth.createSession({ userId, emailVerified: false });

			await auth.markSessionEmailVerified(sessionId);
			const session = await auth.getSessionUserId(sessionId);

			expect(session).toEqual({ userId, emailVerified: true });
		});

		it("should be a no-op for unknown sessions", async () => {
			const auth = makeAuth();

			await auth.markSessionEmailVerified("nonexistent-session");
		});
	});

	describe("findUserByEmail", () => {
		it("should return null for unknown email", async () => {
			const auth = makeAuth();

			const result = await auth.findUserByEmail("noone@example.com");

			expect(result).toBeNull();
		});

		it("should return userId and unverified flag after createUser", async () => {
			const auth = makeAuth();
			const created = await auth.createUser({ email: "test@example.com", password: "password123" });
			assert(created.ok, "User creation failed");

			const result = await auth.findUserByEmail("test@example.com");

			expect(result).toEqual({
				userId: created.userId,
				emailVerified: false,
				registeredAt: expect.any(String),
			});
		});

		it("should reflect markEmailVerified", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "test@example.com", password: "password123" });
			await auth.markEmailVerified("test@example.com");

			const result = await auth.findUserByEmail("test@example.com");

			expect(result?.emailVerified).toBe(true);
		});

		it("should handle case-insensitive email lookup", async () => {
			const auth = makeAuth();
			const created = await auth.createUser({ email: "user@example.com", password: "password123" });
			assert(created.ok, "User creation failed");

			const result = await auth.findUserByEmail("USER@Example.COM");

			expect(result).toEqual({
				userId: created.userId,
				emailVerified: false,
				registeredAt: expect.any(String),
			});
		});

		it("should record registeredAt as an ISO 8601 UTC timestamp captured at user creation", async () => {
			const auth = makeAuth();
			const before = Date.now();
			await auth.createUser({ email: "test@example.com", password: "password123" });
			const after = Date.now();

			const result = await auth.findUserByEmail("test@example.com");
			assert(result?.registeredAt, "registeredAt must be set");
			expect(result.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

			const ts = new Date(result.registeredAt).getTime();
			expect(ts).toBeGreaterThanOrEqual(before);
			expect(ts).toBeLessThanOrEqual(after);
		});

		it("should record registeredAt for Google users too", async () => {
			const auth = makeAuth();
			const userId = UserIdSchema.parse("google-user-rt");
			const before = Date.now();
			await auth.createGoogleUser({ email: "google@example.com", userId });
			const after = Date.now();

			const result = await auth.findUserByEmail("google@example.com");
			assert(result?.registeredAt, "registeredAt must be set");
			expect(result.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

			const ts = new Date(result.registeredAt).getTime();
			expect(ts).toBeGreaterThanOrEqual(before);
			expect(ts).toBeLessThanOrEqual(after);
		});
	});

	describe("createGoogleUser", () => {
		it("should create a user without a password and verified email", async () => {
			const auth = makeAuth();
			const userId = UserIdSchema.parse("google-user-123");

			const result = await auth.createGoogleUser({ email: "google@example.com", userId });

			expect(result).toEqual({ ok: true, userId });
			const lookup = await auth.findUserByEmail("google@example.com");
			expect(lookup).toEqual({
				userId,
				emailVerified: true,
				registeredAt: expect.any(String),
			});
		});

		it("should reject duplicate email", async () => {
			const auth = makeAuth();
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const result = await auth.createGoogleUser({
				email: "test@example.com",
				userId: UserIdSchema.parse("other-id"),
			});

			expect(result).toEqual({ ok: false, reason: "email-already-exists" });
		});

		it("should normalize email case", async () => {
			const auth = makeAuth();
			await auth.createGoogleUser({
				email: "Google@Example.COM",
				userId: UserIdSchema.parse("google-user-1"),
			});

			const result = await auth.createGoogleUser({
				email: "google@example.com",
				userId: UserIdSchema.parse("google-user-2"),
			});

			expect(result).toEqual({ ok: false, reason: "email-already-exists" });
		});

		it("should produce a user that cannot log in with any password", async () => {
			const auth = makeAuth();
			await auth.createGoogleUser({
				email: "google-only@example.com",
				userId: UserIdSchema.parse("google-user-only"),
			});

			const result = await auth.verifyCredentials({
				email: "google-only@example.com",
				password: "any-password",
			});

			expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
		});
	});

	describe("findUserContactByUserId", () => {
		it("returns email and unverified flag for a known userId", async () => {
			const auth = makeAuth();
			const created = await auth.createUser({ email: "contact@example.com", password: "password123" });
			assert(created.ok, "User creation failed");

			const contact = await auth.findUserContactByUserId(created.userId);

			expect(contact).toEqual({ email: "contact@example.com", emailVerified: false });
		});

		it("reports emailVerified=true for Google users", async () => {
			const auth = makeAuth();
			const userId = UserIdSchema.parse("google-contact");
			await auth.createGoogleUser({ email: "g@example.com", userId });

			const contact = await auth.findUserContactByUserId(userId);

			expect(contact).toEqual({ email: "g@example.com", emailVerified: true });
		});

		it("returns null for an unknown userId", async () => {
			const auth = makeAuth();

			const contact = await auth.findUserContactByUserId("nobody" as UserId);

			expect(contact).toBeNull();
		});
	});

	describe("claimReaderReadyEmailSlot", () => {
		const COOLDOWN_MS = 6 * 60 * 60 * 1000;

		async function userIdFor(auth: ReturnType<typeof makeAuth>, email: string): Promise<UserId> {
			const created = await auth.createUser({ email, password: "password123" });
			assert(created.ok, "User creation failed");
			return created.userId;
		}

		it("claims the slot when no reader-ready email has ever been sent", async () => {
			const auth = makeAuth();
			const userId = await userIdFor(auth, "claim@example.com");

			const claimed = await auth.claimReaderReadyEmailSlot({
				userId,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(claimed).toBe(true);
		});

		it("rejects a second claim inside the cooldown window", async () => {
			const auth = makeAuth();
			const userId = await userIdFor(auth, "claim@example.com");
			await auth.claimReaderReadyEmailSlot({
				userId,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			const second = await auth.claimReaderReadyEmailSlot({
				userId,
				now: new Date("2026-05-30T12:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(second).toBe(false);
		});

		it("claims again once the cooldown window has elapsed", async () => {
			const auth = makeAuth();
			const userId = await userIdFor(auth, "claim@example.com");
			await auth.claimReaderReadyEmailSlot({
				userId,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			const later = await auth.claimReaderReadyEmailSlot({
				userId,
				now: new Date("2026-05-30T17:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(later).toBe(true);
		});

		it("returns false for an unknown userId", async () => {
			const auth = makeAuth();

			const claimed = await auth.claimReaderReadyEmailSlot({
				userId: "nobody" as UserId,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(claimed).toBe(false);
		});
	});

	describe("sessions", () => {
		it("should create a session and resolve the userId", async () => {
			const auth = makeAuth();
			const userId = "user-123" as UserId;
			const sessionId = await auth.createSession({ userId, emailVerified: false });

			const resolved = await auth.getSessionUserId(sessionId);

			expect(resolved).toEqual({ userId, emailVerified: false });
		});

		it("should return null for unknown session", async () => {
			const auth = makeAuth();

			const resolved = await auth.getSessionUserId("nonexistent-session");

			expect(resolved).toBeNull();
		});

		it("should destroy a session", async () => {
			const auth = makeAuth();
			const userId = "user-123" as UserId;
			const sessionId = await auth.createSession({ userId, emailVerified: false });

			await auth.destroySession(sessionId);
			const resolved = await auth.getSessionUserId(sessionId);

			expect(resolved).toBeNull();
		});
	});
});
