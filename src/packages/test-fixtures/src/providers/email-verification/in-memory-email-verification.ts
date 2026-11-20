import { randomBytes } from "node:crypto";
import type { UserId } from "@packages/domain/user";
import type {
	ConsumeAgeUnlockToken,
	CreateAgeUnlockToken,
	CreateVerificationToken,
	DeleteVerificationTokensByUserId,
	VerificationToken,
	VerifyEmailToken,
} from "@packages/provider-contracts/email-verification";
import { VerificationTokenSchema } from "@packages/provider-contracts/email-verification";

export function initInMemoryEmailVerification(): {
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
	createAgeUnlockToken: CreateAgeUnlockToken;
	consumeAgeUnlockToken: ConsumeAgeUnlockToken;
	deleteTokensByUserId: DeleteVerificationTokensByUserId;
} {
	const tokens = new Map<VerificationToken, { userId: UserId; email: string; purpose: "email" | "age-unlock" }>();

	const createVerificationToken: CreateVerificationToken = async ({ userId, email }) => {
		const token = VerificationTokenSchema.parse(randomBytes(32).toString("hex"));
		tokens.set(token, { userId, email, purpose: "email" });
		return token;
	};

	const consume = (args: { token: VerificationToken; purpose: "email" | "age-unlock" }) => {
		const entry = tokens.get(args.token);
		if (entry?.purpose !== args.purpose) return null;
		tokens.delete(args.token);
		return entry;
	};

	const verifyEmailToken: VerifyEmailToken = async (token) => {
		const entry = consume({ token, purpose: "email" });
		if (!entry) return { ok: false, reason: "invalid-token" };
		return { ok: true, userId: entry.userId, email: entry.email };
	};

	const createAgeUnlockToken: CreateAgeUnlockToken = async ({ userId, email }) => {
		const token = VerificationTokenSchema.parse(randomBytes(32).toString("hex"));
		tokens.set(token, { userId, email, purpose: "age-unlock" });
		return token;
	};

	const consumeAgeUnlockToken: ConsumeAgeUnlockToken = async (token) => {
		const entry = consume({ token, purpose: "age-unlock" });
		if (!entry) return { ok: false, reason: "invalid-token" };
		return { ok: true, userId: entry.userId };
	};

	const deleteTokensByUserId: DeleteVerificationTokensByUserId = async (userId) => {
		for (const [token, entry] of tokens) {
			if (entry.userId === userId) tokens.delete(token);
		}
	};

	return { createVerificationToken, verifyEmailToken, createAgeUnlockToken, consumeAgeUnlockToken, deleteTokensByUserId };
}
