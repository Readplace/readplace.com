import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request } from "express";
import type { RefuseAdminAccess } from "@packages/admin-gate";
import { type BannerState, type RenderBase, sendComponent } from "@packages/web-shell";
import { ADMIN_DASHBOARD_STYLES } from "./admin-dashboard.styles";

const TEMPLATE = readFileSync(join(__dirname, "admin-forbidden.template.html"), "utf-8");

export function initRefuseAdminAccess(deps: {
	base: RenderBase;
	bannerStateFor: (req: Request) => Promise<BannerState>;
}): RefuseAdminAccess {
	return async (req, res) => {
		sendComponent(
			req,
			res,
			deps.base(
				{
					seo: {
						title: "Admin access required | Readplace",
						description: "Operator tools. Not for public consumption.",
						canonicalUrl: "/admin",
						robots: "noindex, nofollow",
					},
					styles: ADMIN_DASHBOARD_STYLES,
					bodyClass: "page-admin-forbidden",
					content: { html: TEMPLATE },
					statusCode: 403,
				},
				await deps.bannerStateFor(req),
			),
		);
	};
}
