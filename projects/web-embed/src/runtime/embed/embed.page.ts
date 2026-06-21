import express, { type Router } from "express";
import helmet from "helmet";
import { sendComponent } from "@packages/web-shell";
import { EmbedPage } from "./embed.component";
import { PreviewPage } from "./preview.component";
import { EMBED_ICON_SVG } from "./icon";
import { EMBED_CLIENT_JS } from "./embed-client-script";

export function initEmbedRoutes(deps: { appOrigin: string }): Router {
	const embedOrigin = `${deps.appOrigin}/embed`;
	const router = express.Router();

	router.use(
		helmet({
			contentSecurityPolicy: false,
			crossOriginEmbedderPolicy: false,
			crossOriginResourcePolicy: { policy: "cross-origin" },
		}),
	);

	router.get("/", (req, res) => {
		sendComponent(req, res, EmbedPage({ appOrigin: deps.appOrigin, embedOrigin }));
	});

	router.get("/preview", (req, res) => {
		sendComponent(req, res, PreviewPage({ appOrigin: deps.appOrigin, embedOrigin }));
	});

	router.get("/icon.svg", (_req, res) => {
		res
			.type("image/svg+xml")
			.set("Cache-Control", "public, max-age=31536000, immutable")
			.send(EMBED_ICON_SVG);
	});

	router.get("/embed.client.js", (_req, res) => {
		/** Revalidate, don't cache immutably: the page HTML is rendered fresh per
		 * request and the script depends on its IDs/classes, so a stale-but-valid
		 * copy would desync from the markup. The weak ETag res.send() emits keeps
		 * returning visitors on cheap 304s. icon.svg stays immutable because it is
		 * a canonical, content-stable URL embedded across the web. */
		res
			.type("text/javascript")
			.set("Cache-Control", "public, max-age=0, must-revalidate")
			.send(EMBED_CLIENT_JS);
	});

	return router;
}
