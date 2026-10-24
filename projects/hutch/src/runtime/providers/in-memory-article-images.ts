import { Router } from "express";
import type { PutImageObject } from "@packages/finalize-article";

export function initInMemoryArticleImages(): { putImageObject: PutImageObject; router: Router } {
	const images = new Map<string, { body: Buffer; contentType: string }>();
	const putImageObject: PutImageObject = async ({ key, body, contentType }) => {
		images.set(key, { body, contentType });
	};
	const router = Router();
	router.get(/^\/content\/[^/]+\/images\/.+$/, (req, res) => {
		const image = images.get(decodeURIComponent(req.path.slice(1)));
		if (image === undefined) {
			res.sendStatus(404);
			return;
		}
		res.type(image.contentType).send(image.body);
	});
	return { putImageObject, router };
}
