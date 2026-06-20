import type { NextFunction, Request, Response } from "express";
import { CHANGELOG_DISMISS_COOKIE_NAME } from "@packages/web-shell";

/** Lifts the changelog dismissal cookie onto a typed request field so
 * buildBannerState — which sees the request structurally as a BannerStateSource —
 * can suppress an announcement the reader has already dismissed. Mounted after
 * cookieParser, which always populates req.cookies, so the index needs no
 * optional chain. */
export function changelogDismissMiddleware(
	req: Request,
	_res: Response,
	next: NextFunction,
): void {
	req.dismissedChangelogVersion = req.cookies[CHANGELOG_DISMISS_COOKIE_NAME];
	next();
}
