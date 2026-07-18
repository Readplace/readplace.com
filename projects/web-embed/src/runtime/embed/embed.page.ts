import express, { type Request, type Router } from "express";
import helmet from "helmet";
import { bannerStateFromRequest, type RenderBase, sendComponent } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import { contentSignalMiddleware } from "./content-signal.middleware";
import { EmbedPage } from "./embed.component";
import { PreviewPage } from "./preview.component";
import { EMBED_ICON_SVG } from "./icon";
import { EMBED_CLIENT_JS } from "./embed-client-script";

export function initEmbedRoutes(deps: {
	appOrigin: string;
	base: RenderBase;
	resolveLogin: ResolveLogin;
}): Router {
	const embedOrigin = `${deps.appOrigin}/embed`;
	const router = express.Router();

	router.use(
		helmet({
			contentSecurityPolicy: false,
			crossOriginEmbedderPolicy: false,
			crossOriginResourcePolicy: { policy: "cross-origin" },
		}),
	);
	router.use(contentSignalMiddleware);

	/** Reads the host-only session cookie the browser already sends to /embed
	 * (hutch owns it; same-origin) and turns it into the banner state that flips
	 * the shared header between guest and authenticated nav. No cookie or an
	 * invalid/expired session resolves to guest. */
	async function bannerStateFor(req: Request) {
		const login = await deps.resolveLogin(req.headers.cookie);
		return bannerStateFromRequest({
			userId: login.isAuthenticated ? login.userId : undefined,
			emailVerified: login.isAuthenticated ? login.emailVerified : undefined,
			originalUrl: req.originalUrl,
			query: req.query,
		});
	}

	router.get("/", async (req, res) => {
		const state = await bannerStateFor(req);
		sendComponent(req, res, deps.base(EmbedPage({ appOrigin: deps.appOrigin, embedOrigin }), state));
	});

	router.get("/preview", async (req, res) => {
		const state = await bannerStateFor(req);
		sendComponent(req, res, deps.base(PreviewPage({ appOrigin: deps.appOrigin, embedOrigin }), state));
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
