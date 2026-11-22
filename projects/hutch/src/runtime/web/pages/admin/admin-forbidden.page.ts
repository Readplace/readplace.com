import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RefuseAdminAccess } from "@packages/admin-gate";
import { sendComponent } from "@packages/web-shell";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { ADMIN_INDEX_STYLES } from "./admin-index.styles";

const TEMPLATE = readFileSync(join(__dirname, "admin-forbidden.template.html"), "utf-8");

export function initRefuseAdminAccess(deps: { buildBannerState: BuildBannerState }): RefuseAdminAccess {
	return async (req, res) => {
		sendComponent(
			req,
			res,
			Base(
				{
					seo: {
						title: "Admin access required | Readplace",
						description: "Operator tools. Not for public consumption.",
						canonicalUrl: "/admin",
						robots: "noindex, nofollow",
					},
					styles: ADMIN_INDEX_STYLES,
					bodyClass: "page-admin-forbidden",
					content: { html: TEMPLATE },
					statusCode: 403,
				},
				await deps.buildBannerState(req),
			),
		);
	};
}
