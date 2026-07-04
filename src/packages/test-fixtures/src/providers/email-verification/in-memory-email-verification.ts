import { randomBytes } from "node:crypto";
import type { UserId } from "@packages/domain/user";
import type {
	CreateVerificationToken,
	VerificationToken,
	VerifyEmailToken,
} from "@packages/provider-contracts/email-verification";
import { VerificationTokenSchema } from "@packages/provider-contracts/email-verification";

export function initInMemoryEmailVerification(): {
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
} {
	const tokens = new Map<VerificationToken, { userId: UserId; email: string }>();

	const createVerificationToken: CreateVerificationToken = async ({ userId, email }) => {
		const token = VerificationTokenSchema.parse(randomBytes(32).toString("hex"));
		tokens.set(token, { userId, email });
		return token;
	};

	const verifyEmailToken: VerifyEmailToken = async (token) => {
		const entry = tokens.get(token);
		if (!entry) {
			return { ok: false, reason: "invalid-token" };
		}
		tokens.delete(token);
		return { ok: true, userId: entry.userId, email: entry.email };
	};

	return { createVerificationToken, verifyEmailToken };
}
