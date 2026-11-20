import { UserIdSchema, type UserId } from "@packages/domain/user";
import type { VerificationToken } from "./email-verification.types";
import { initInMemoryEmailVerification } from "./in-memory-email-verification";

describe("initInMemoryEmailVerification", () => {
	it("creates a token and verifies it successfully", async () => {
		const { createVerificationToken, verifyEmailToken } = initInMemoryEmailVerification();
		const userId = "user-1" as UserId;

		const token = await createVerificationToken({ userId, email: "user@example.com" });
		const result = await verifyEmailToken(token);

		expect(result).toEqual({ ok: true, userId, email: "user@example.com" });
	});

	it("rejects an unknown token", async () => {
		const { verifyEmailToken } = initInMemoryEmailVerification();

		const result = await verifyEmailToken("nonexistent-token" as VerificationToken);

		expect(result).toEqual({ ok: false, reason: "invalid-token" });
	});

	it("rejects a token that has already been consumed", async () => {
		const { createVerificationToken, verifyEmailToken } = initInMemoryEmailVerification();
		const token = await createVerificationToken({ userId: "user-1" as UserId, email: "a@b.com" });

		await verifyEmailToken(token);
		const secondAttempt = await verifyEmailToken(token);

		expect(secondAttempt).toEqual({ ok: false, reason: "invalid-token" });
	});

	it("deletes every token for a user and leaves other users' tokens intact", async () => {
		const { createVerificationToken, verifyEmailToken, deleteTokensByUserId } =
			initInMemoryEmailVerification();
		const target = "user-1" as UserId;
		const other = "user-2" as UserId;
		const targetToken = await createVerificationToken({ userId: target, email: "t@example.com" });
		const otherToken = await createVerificationToken({ userId: other, email: "o@example.com" });

		await deleteTokensByUserId(target);

		expect(await verifyEmailToken(targetToken)).toEqual({ ok: false, reason: "invalid-token" });
		expect(await verifyEmailToken(otherToken)).toEqual({
			ok: true,
			userId: other,
			email: "o@example.com",
		});
	});

	it("keeps age-unlock tokens and email tokens apart, and consumes each once", async () => {
		const verification = initInMemoryEmailVerification();
		const userId = UserIdSchema.parse("user-1");
		const unlockToken = await verification.createAgeUnlockToken({ userId, email: "t@example.com" });
		const emailToken = await verification.createVerificationToken({ userId, email: "t@example.com" });

		expect(await verification.verifyEmailToken(unlockToken)).toEqual({ ok: false, reason: "invalid-token" });
		expect(await verification.consumeAgeUnlockToken(emailToken)).toEqual({ ok: false, reason: "invalid-token" });
		expect(await verification.consumeAgeUnlockToken(unlockToken)).toEqual({ ok: true, userId });
		expect(await verification.consumeAgeUnlockToken(unlockToken)).toEqual({ ok: false, reason: "invalid-token" });
	});
});
