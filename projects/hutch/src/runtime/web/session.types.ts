import type { UserId } from "@packages/domain/user";
import type { VisitorId } from "./visitor-id.middleware";

declare global {
	namespace Express {
		interface Request {
			userId?: UserId;
			emailVerified?: boolean;
			visitorId?: VisitorId;
		}
	}
}
