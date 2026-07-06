import { initInMemoryPasswordReset } from "./in-memory-password-reset";

describe("initInMemoryPasswordReset", () => {
	it("issues a token and verifies it once", async () => {
		const { createPasswordResetToken, verifyPasswordResetToken } = initInMemoryPasswordReset();

		const token = await createPasswordResetToken({ email: "user@example.com" });
		const first = await verifyPasswordResetToken(token);

		expect(first).toEqual({ ok: true, email: "user@example.com" });
	});

	it("rejects a token after it has been verified once (single-use)", async () => {
		const { createPasswordResetToken, verifyPasswordResetToken } = initInMemoryPasswordReset();

		const token = await createPasswordResetToken({ email: "user@example.com" });
		await verifyPasswordResetToken(token);

		expect(await verifyPasswordResetToken(token)).toEqual({
			ok: false,
			reason: "invalid-token",
		});
	});

	it("rejects an unknown token", async () => {
		const { createPasswordResetToken, verifyPasswordResetToken } = initInMemoryPasswordReset();
		const realToken = await createPasswordResetToken({ email: "user@example.com" });

		const unknown = `${realToken}-extra`;
		const PasswordResetTokenSchema = (await import("./password-reset.schema"))
			.PasswordResetTokenSchema;
		expect(
			await verifyPasswordResetToken(PasswordResetTokenSchema.parse(unknown)),
		).toEqual({ ok: false, reason: "invalid-token" });
	});

	it("deletes every token for the given email and leaves other emails' tokens intact", async () => {
		const { createPasswordResetToken, verifyPasswordResetToken, deleteTokensByEmail } =
			initInMemoryPasswordReset();
		const firstForTarget = await createPasswordResetToken({ email: "target@example.com" });
		const secondForTarget = await createPasswordResetToken({ email: "target@example.com" });
		const otherToken = await createPasswordResetToken({ email: "other@example.com" });

		await deleteTokensByEmail("target@example.com");

		expect(await verifyPasswordResetToken(firstForTarget)).toEqual({
			ok: false,
			reason: "invalid-token",
		});
		expect(await verifyPasswordResetToken(secondForTarget)).toEqual({
			ok: false,
			reason: "invalid-token",
		});
		expect(await verifyPasswordResetToken(otherToken)).toEqual({
			ok: true,
			email: "other@example.com",
		});
	});

	it("normalizes email casing on write and delete so a mixed-case reset is still scrubbed", async () => {
		const { createPasswordResetToken, verifyPasswordResetToken, deleteTokensByEmail } =
			initInMemoryPasswordReset();
		const token = await createPasswordResetToken({ email: "John@Example.com" });

		// The deletion scrub passes the normalized users-table PK; it must match the
		// row written from the mixed-case request.
		await deleteTokensByEmail("john@example.com");

		expect(await verifyPasswordResetToken(token)).toEqual({
			ok: false,
			reason: "invalid-token",
		});
	});
});
