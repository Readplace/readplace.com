import type { UserId } from "@packages/domain/user";
import { z } from "zod";

export const BrowserHandoffCodeSchema = z.string().min(1).brand<"BrowserHandoffCode">();

export type BrowserHandoffCode = z.infer<typeof BrowserHandoffCodeSchema>;

export type MintBrowserHandoffCode = (args: {
	userId: UserId;
	emailVerified: boolean;
	oauthClientId: string;
}) => Promise<BrowserHandoffCode>;

export type RedeemBrowserHandoffCode = (code: BrowserHandoffCode) => Promise<
	| { ok: true; userId: UserId; emailVerified: boolean; oauthClientId: string }
	| { ok: false; reason: "invalid-code" }
>;
