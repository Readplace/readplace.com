import express, { type Router } from "express";
import helmet from "helmet";
import { sendComponent } from "../../send-component";
import { EmbedPage } from "./embed.component";
import { PreviewPage } from "./preview.component";
import { EMBED_ICON_SVG } from "./icon";

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

	return router;
}
