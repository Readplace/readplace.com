import type { RequestHandler } from "express";

const CONTENT_SECURITY_POLICY = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'";

export const sendContentSecurityPolicy: RequestHandler = (_req, res, next) => {
	res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
	next();
};
