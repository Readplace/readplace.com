import type { Request } from "express";

/** Two known false-negatives accepted in v1:
 * 1. iPad iPadOS 13+ identifies as Macintosh in its default UA, so iPad users
 *    fall through to desktop. Revisit if support tickets show a pattern.
 * 2. Firefox Android does support extensions, but is treated as mobile here
 *    because the install flow is desktop-shaped. Same: revisit on demand. */
export function isMobileUserAgent(ua: string): boolean {
	return /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
}

export function detectMobile(req: Request): boolean {
	return isMobileUserAgent(req.headers["user-agent"] ?? "");
}
