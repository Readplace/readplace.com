import { randomBytes } from "node:crypto";
import type { UserId } from "@packages/domain/user";
import type {
	BrowserHandoffCode,
	MintBrowserHandoffCode,
	RedeemBrowserHandoffCode,
} from "@packages/provider-contracts/browser-handoff";
import { BrowserHandoffCodeSchema } from "./browser-handoff.schema";

const CODE_TTL_MS = 60 * 1000;

export function initInMemoryBrowserHandoff(deps: { now: () => Date }): {
	mintBrowserHandoffCode: MintBrowserHandoffCode;
	redeemBrowserHandoffCode: RedeemBrowserHandoffCode;
} {
	const codes = new Map<
		BrowserHandoffCode,
		{ userId: UserId; emailVerified: boolean; oauthClientId: string; expiresAtMs: number }
	>();

	const mintBrowserHandoffCode: MintBrowserHandoffCode = async ({ userId, emailVerified, oauthClientId }) => {
		const code = BrowserHandoffCodeSchema.parse(randomBytes(32).toString("base64url"));
		codes.set(code, { userId, emailVerified, oauthClientId, expiresAtMs: deps.now().getTime() + CODE_TTL_MS });
		return code;
	};

	const redeemBrowserHandoffCode: RedeemBrowserHandoffCode = async (code) => {
		const entry = codes.get(code);
		codes.delete(code);
		if (!entry || entry.expiresAtMs < deps.now().getTime()) {
			return { ok: false, reason: "invalid-code" };
		}
		return { ok: true, userId: entry.userId, emailVerified: entry.emailVerified, oauthClientId: entry.oauthClientId };
	};

	return { mintBrowserHandoffCode, redeemBrowserHandoffCode };
}
