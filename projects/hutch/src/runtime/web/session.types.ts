import type { UserId } from "@packages/domain/user";

declare global {
	namespace Express {
		interface Request {
			userId?: UserId;
			emailVerified?: boolean;
		}
	}
}
