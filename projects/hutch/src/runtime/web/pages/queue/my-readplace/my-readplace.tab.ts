import assert from "node:assert";
import type { Request, Response } from "express";
import { classifyDeviceClass } from "@packages/web-analytics";
import { sendComponent, withInternalTracking } from "@packages/web-shell";
import type { QuerystringFeatureToggle } from "@packages/web-shell";
import type { CountArticlesByUser } from "@packages/provider-contracts/article-store";
import type {
	GetReadingPreference,
	SaveReadingPreference,
} from "@packages/provider-contracts/reading-preference";
import { Base } from "../../../base.component";
import type { BuildBannerState } from "../../../banner-state";
import type { QueueTab } from "../queue-tab";
import {
	UNREAD_BADGE_COUNT_LIMIT,
	renderQueueCounts,
	type QueueCountsDisplayModel,
} from "../queue-counts.component";
import { filterLinkClass, formatUnreadLabel } from "../queue-filters.component";
import { QUEUE_PATH, buildQueueUrl } from "../queue.url";
import { MyReadplacePage, myReadplaceTabLink } from "./my-readplace.component";
import { MyReadplaceBodySchema, toMyReadplaceViewModel } from "./my-readplace.viewmodel";
import {
	MY_READPLACE_FEATURE,
	MY_READPLACE_TAB_ID,
	buildMyReadplaceUrl,
	parseMyReadplaceState,
} from "./my-readplace.url";

function toMyTabCountsDisplayModel(input: { unreadCount: number }): QueueCountsDisplayModel {
	return {
		filterUnreadClass: filterLinkClass(false),
		filterUnreadUrl: withInternalTracking(
			buildQueueUrl({ tab: "queue", feature: MY_READPLACE_FEATURE }),
			{ source: "queue-filters", content: "filter-unread" },
		),
		filterUnreadLabel: formatUnreadLabel(input.unreadCount),
		showPageCount: false,
		currentPage: 1,
		totalPages: 1,
	};
}

export function initMyReadplaceTab(deps: {
	featureToggle: QuerystringFeatureToggle;
	getReadingPreference: GetReadingPreference;
	saveReadingPreference: SaveReadingPreference;
	countArticlesByUser: CountArticlesByUser;
	buildBannerState: BuildBannerState;
	now: () => Date;
}): QueueTab {
	return {
		id: MY_READPLACE_TAB_ID,

		isEnabled(req) {
			return deps.featureToggle.isEnabled(req, MY_READPLACE_FEATURE);
		},

		filterTab: myReadplaceTabLink,

		async renderPage(req, res) {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const preference = await deps.getReadingPreference({ userId: req.userId });
			const state = parseMyReadplaceState(req.query);
			sendComponent(
				req, res,
				Base(
					MyReadplacePage(
						toMyReadplaceViewModel({
							preference,
							edit: state.edit,
							invalid: state.invalid,
						}),
						{ deviceClass: classifyDeviceClass(req.get("user-agent")), now: deps.now() },
					),
					await deps.buildBannerState(req),
				),
			);
		},

		async renderCounts(req, res) {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const unreadCount = await deps.countArticlesByUser({
				userId: req.userId,
				status: "unread",
				countLimit: UNREAD_BADGE_COUNT_LIMIT,
			});
			res.type("html").send(renderQueueCounts(toMyTabCountsDisplayModel({ unreadCount })));
		},

		registerRoutes(router) {
			router.post("/my-readplace", async (req: Request, res: Response) => {
				assert(req.userId, "userId required - route must be protected by requireAuth");
				const userId = req.userId;
				if (!deps.featureToggle.isEnabled(req, MY_READPLACE_FEATURE)) {
					res.redirect(303, QUEUE_PATH);
					return;
				}
				const body = MyReadplaceBodySchema.safeParse(req.body);
				if (!body.success) {
					res.redirect(303, buildMyReadplaceUrl({ edit: true, invalid: true }));
					return;
				}
				await deps.saveReadingPreference({ userId, text: body.data.text });
				res.redirect(303, buildMyReadplaceUrl());
			});
		},
	};
}
