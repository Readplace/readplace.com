import { randomBytes } from "node:crypto";
import { normalizeEmail } from "@packages/domain/user";
import type {
	CreatePasswordResetToken,
	DeletePasswordResetTokensByEmail,
	PasswordResetToken,
	VerifyPasswordResetToken,
} from "@packages/provider-contracts/password-reset";
import { PasswordResetTokenSchema } from "./password-reset.schema";

export function initInMemoryPasswordReset(): {
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
	deleteTokensByEmail: DeletePasswordResetTokensByEmail;
} {
	const tokens = new Map<PasswordResetToken, { email: string }>();

	const createPasswordResetToken: CreatePasswordResetToken = async ({ email }) => {
		const token = PasswordResetTokenSchema.parse(randomBytes(32).toString("hex"));
		// Mirror the DynamoDB provider: store the normalized email so the deletion
		// scrub (which filters on the normalized users-table PK) matches it.
		tokens.set(token, { email: normalizeEmail(email) });
		return token;
	};

	const verifyPasswordResetToken: VerifyPasswordResetToken = async (token) => {
		const entry = tokens.get(token);
		if (!entry) {
			return { ok: false, reason: "invalid-token" };
		}
		tokens.delete(token);
		return { ok: true, email: entry.email };
	};

	const deleteTokensByEmail: DeletePasswordResetTokensByEmail = async (email) => {
		const normalized = normalizeEmail(email);
		for (const [token, entry] of tokens) {
			if (entry.email === normalized) tokens.delete(token);
		}
	};

	return { createPasswordResetToken, verifyPasswordResetToken, deleteTokensByEmail };
}
