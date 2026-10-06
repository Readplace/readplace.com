import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { render, sendComponent } from "@packages/web-shell";
import type { FindUserByEmail } from "@packages/provider-contracts/auth";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { ADMIN_INDEX_STYLES } from "./admin-index.styles";
import { initRefuseAdminAccess } from "./admin-forbidden.page";
import { initRequireAdmin } from "./require-admin.middleware";
import type { StarterReport } from "../../../domain/engagement/starter-report";

const TEMPLATE = readFileSync(join(__dirname, "admin-index.template.html"), "utf-8");

const ADMIN_INDEX_SOURCE = "admin-index";

const ADMIN_LINKS = [
	{
		key: "newsletters",
		label: "Newsletters",
		description: "Review, approve and correct the shared newsletter catalog.",
		path: "/admin/newsletters",
	},
	{
		key: "recrawl",
		label: "Recrawl an article",
		description: "Fetch a saved article again and compare crawl versions.",
		path: "/admin/recrawl",
	},
	{
		key: "extend-trial",
		label: "Extend a trial",
		description: "Re-open a trial window for a reader.",
		path: "/admin/extend-trial",
	},
];

export interface AdminIndexDependencies {
	getStarterReport: () => Promise<StarterReport | undefined>;
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	buildBannerState: BuildBannerState;
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
	res.setHeader("Cache-Control", "no-store");
	next();
}

export function initAdminIndexHandlers(deps: AdminIndexDependencies): RequestHandler[] {
	const links = ADMIN_LINKS.map((link) => ({
		key: link.key,
		label: link.label,
		description: link.description,
		method: "GET",
		action: link.path,
		fields: [
			{ name: "utm_source", value: ADMIN_INDEX_SOURCE },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: link.key },
		],
	}));
	const renderIndex: RequestHandler = async (req, res) => {
		const report = await deps.getStarterReport();
		const starterReports =
			report === undefined
				? []
				: [
						{
							report,
							difference: (100 * report.absoluteActivationDifference).toFixed(2),
							differenceLow: (100 * report.differenceInterval[0]).toFixed(2),
							differenceHigh: (100 * report.differenceInterval[1]).toFixed(2),
							fisher: report.twoSidedFisherPValue.toFixed(4),
							cohorts: Object.entries(report.cohorts).map(([cohort, arms]) => ({
								cohort,
								...arms,
							})),
						},
					];
		sendComponent(
			req,
			res,
			Base(
				{
					seo: {
						title: "Admin | Readplace",
						description: "Operator tools. Not for public consumption.",
						canonicalUrl: "/admin",
						robots: "noindex, nofollow",
					},
					styles: ADMIN_INDEX_STYLES,
					bodyClass: "page-admin",
					content: { html: render(TEMPLATE, { links, starterReports }) },
				},
				await deps.buildBannerState(req),
			),
		);
	};
	return [
		noStore,
		initRequireAdmin({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			serviceToken: "",
			refuse: initRefuseAdminAccess({ buildBannerState: deps.buildBannerState }),
		}),
		renderIndex,
	];
}
