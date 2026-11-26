import { type BannerState, type RenderBase, sendComponent } from "@packages/web-shell";
import { ADMIN_FORBIDDEN_TEMPLATE } from "./admin-forbidden.template";

type SendComponentArgs = Parameters<typeof sendComponent>;

export function initRefuseAdminAccess<Req>(deps: {
	base: RenderBase;
	bannerStateFor: (req: Req) => Promise<BannerState>;
	styles: string;
}): (req: Req & SendComponentArgs[0], res: SendComponentArgs[1]) => Promise<void> {
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
					styles: deps.styles,
					bodyClass: "page-admin-forbidden",
					content: { html: ADMIN_FORBIDDEN_TEMPLATE },
					statusCode: 403,
				},
				await deps.bannerStateFor(req),
			),
		);
	};
}
