import type { RequestHandler } from "express";
import { UploadIdSchema } from "@packages/media-contracts";

export const redirectAnonymousToUploadSignup: RequestHandler = (req, res, next) => {
	if (req.userId) {
		next();
		return;
	}
	const uploadId = UploadIdSchema.safeParse(req.params.id);
	if (!uploadId.success) {
		res.redirect(303, "/signup");
		return;
	}
	res.redirect(303, `/signup?return=${encodeURIComponent(`/upload/${uploadId.data}`)}`);
};
