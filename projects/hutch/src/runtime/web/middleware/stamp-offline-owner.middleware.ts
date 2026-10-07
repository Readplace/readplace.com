import assert from "node:assert";
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import {
	OFFLINE_OWNER_EXPIRES_HEADER,
	OFFLINE_OWNER_HEADER,
} from "../shared/offline-reader/offline-cache";

export const stampOfflineOwner: RequestHandler = (req, res, next) => {
	if (req.sessionExpiresAt !== undefined) {
		const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
		assert(sessionId, "a resolved session must carry its cookie");
		res.set(OFFLINE_OWNER_HEADER, createHash("sha256").update(sessionId).digest("hex"));
		res.set(OFFLINE_OWNER_EXPIRES_HEADER, String(req.sessionExpiresAt));
	}
	next();
};
