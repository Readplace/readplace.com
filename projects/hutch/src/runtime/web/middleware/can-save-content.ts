import type { Request } from "express";
import { isAccountLocked } from "./require-not-locked.middleware";

export type CanSaveContent = (req: Pick<Request, "userId" | "verificationStatus">) => Promise<boolean>;

export function initCanSaveContent(): CanSaveContent {
	return async (req) => !isAccountLocked(req);
}
