import assert from "node:assert";
import {
	ReadlistSlugSchema,
	decideReadlistPurpose,
	type ReadlistPurposeRejection,
} from "@packages/domain/readlist";
import type {
	ListReadlistDefinitions,
	SetReadlistDefinitionPurpose,
} from "@packages/provider-contracts/article-store";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { sendComponent } from "@packages/web-shell";
import express from "express";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";

import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { readerReadlists } from "./readlist-context";
import { preferencesUrl, readlistPreferencesEnabled } from "./readlist-preferences-feature";
import { ReadlistPreferencesPage } from "./readlist-preferences.component";
import { buildReadlistRail } from "./readlist-rail";
import { READLIST_ERROR_UNKNOWN_READLIST, READLIST_PURPOSE_INVALID_MESSAGE } from "./readlist.error";
import { buildReadlistUrl } from "./readlist.url";

const PREFERENCES_ERROR_CODES = ["invalid-purpose"] as const;

type PreferencesErrorCode = (typeof PREFERENCES_ERROR_CODES)[number];

const PREFERENCES_ERROR_MESSAGES: Record<PreferencesErrorCode, string> = {
	"invalid-purpose": READLIST_PURPOSE_INVALID_MESSAGE,
};

const PreferencesQuerySchema = z.object({
	purpose: z.string().optional().catch(undefined),
	preferences_error: z.enum(PREFERENCES_ERROR_CODES).optional().catch(undefined),
});

export function initReadlistPreferencesRoutes(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose;
	getEffectiveAccess: GetEffectiveAccess;
	buildBannerState: BuildBannerState;
	requireWriteAccess: RequestHandler;
}): Router {
	const router = express.Router();

	const unknownReadlist = (res: Response): void => {
		res.redirect(303, buildReadlistUrl({}, [["queue_error", READLIST_ERROR_UNKNOWN_READLIST]]));
	};

	router.get("/queues/:slug/preferences", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const requested = ReadlistSlugSchema.safeParse(req.params.slug);
		if (!requested.success) {
			unknownReadlist(res);
			return;
		}
		const definitions = await deps.listReadlistDefinitions(userId);
		const definition = definitions.find((owned) => owned.slug === requested.data);
		if (!definition) {
			unknownReadlist(res);
			return;
		}

		const parsed = PreferencesQuerySchema.parse(req.query);
		const access = await deps.getEffectiveAccess(userId);
		const activeReadlist = { slug: definition.slug, label: definition.label };
		const context = {
			state: { readlist: definition.slug, tab: "queue", page: 1 } as const,
			activeReadlist,
			readlists: readerReadlists(definitions),
		};
		const draft = parsed.purpose;

		sendComponent(
			req,
			res,
			Base(
				ReadlistPreferencesPage({
					readlist: { ...activeReadlist, purpose: definition.purpose },
					rail: buildReadlistRail({
						query: req.query,
						context,
						accessIsReadOnly: access.access === "read-only",
					}),
					values: { purpose: draft ?? definition.purpose },
					wizardOpen: draft !== undefined || parsed.preferences_error !== undefined,
					preferencesEnabled: readlistPreferencesEnabled(req.query),
					purposeError:
						parsed.preferences_error === undefined
							? undefined
							: PREFERENCES_ERROR_MESSAGES[parsed.preferences_error],
				}),
				await deps.buildBannerState(req, { preFetchedAccess: access }),
			),
		);
	});

	router.post(
		"/queues/:slug/preferences",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success) {
				unknownReadlist(res);
				return;
			}
			const slug = requested.data;
			const enabled = readlistPreferencesEnabled(req.query);
			const rejections: Record<ReadlistPurposeRejection, () => void> = {
				"unknown-readlist": () => unknownReadlist(res),
				"invalid-purpose": () => {
					res.redirect(
						303,
						preferencesUrl({
							slug,
							enabled,
							extra: [["preferences_error", "invalid-purpose"]],
						}),
					);
				},
			};

			const definitions = await deps.listReadlistDefinitions(userId);
			const decision = decideReadlistPurpose({
				slug,
				purpose: typeof req.body?.purpose === "string" ? req.body.purpose : "",
				readlists: readerReadlists(definitions),
			});
			if (!decision.ok) {
				rejections[decision.reason]();
				return;
			}

			const { updated } = await deps.setReadlistDefinitionPurpose({
				userId,
				slug: decision.slug,
				purpose: decision.purpose,
			});
			if (!updated) {
				unknownReadlist(res);
				return;
			}
			res.redirect(303, preferencesUrl({ slug: decision.slug, enabled }));
		},
	);

	return router;
}
