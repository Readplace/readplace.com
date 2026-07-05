import { randomBytes } from "node:crypto";
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
		tokens.set(token, { email });
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
		for (const [token, entry] of tokens) {
			if (entry.email === email) tokens.delete(token);
		}
	};

	return { createPasswordResetToken, verifyPasswordResetToken, deleteTokensByEmail };
}
