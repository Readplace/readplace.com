import type { RequestHandler } from "express";

export const redirectAnonymousToUploadSignup: RequestHandler = (req, res, next) => {
	if (req.userId) {
		next();
		return;
	}
	res.redirect(303, `/signup?return=${encodeURIComponent("/upload")}`);
};
