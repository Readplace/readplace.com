
import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import express from "express";
import type { UserId } from "@packages/domain/user";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { wantsSiren } from "../../content-negotiation";
import { readlistHref, } from "../../api/readlist-href";
import {
	buildReadlistUrl,
} from "./readlist.url";
import {
	readerReadlists,
} from "./readlist-context";
import {
	DEFAULT_READLIST_SLUG,
	ReadlistSlugSchema,
	parseReadlistPurpose,
	type ReadlistSlug,
	decideOwnedCustomReadlist,
	decideReadlistMigration,
	decideReadlistPin,
	decideReadlistRename,
	readlistAfterDelete,
} from "@packages/domain/readlist";
import { READLIST_CREATE_REJECTIONS, READLIST_ERROR_LIMIT, READLIST_LIMIT_MESSAGE, type ReadlistCreateDialogRejection, READLIST_ERROR_PIN_LIMIT, READLIST_ERROR_UNKNOWN_READLIST, READLIST_RENAME_REJECTIONS, } from "./readlist.error";
import { READLIST_CREATE_POPOVER_ID, renderReadlistCreateForm } from "./readlist-create.component";
import { readlistRenamePopoverId, renderReadlistRenameForm } from "./readlist-rename.component";
import { answerReadlistNaming, type ReadlistNaming } from "./readlist-naming-answer";
import { PIN_LIMIT_REFUSAL, UNKNOWN_READLIST_REFUSAL, refuseOverSiren } from "./readlist-siren-refusal";
import {
	readlistQueryKeyOf,
} from "../../onboarding/native-client";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import type { ReadlistShared, } from "./readlist-shared";

const READLIST_PURGE_PAGE_SIZE = 25;

const ReadlistCreateBodySchema = z
	.object({
		label: z.string().catch(""),
		smart: z.literal("1").optional().catch(undefined),
		purpose: z.string().catch(""),
	})
	.catch({ label: "", smart: undefined, purpose: "" });

export function initReadlistQueueRoutes(
	deps: Pick<
		ReadlistDependencies,
		"findReadlistArticles" | "upsertReadlist" | "listReadlistDefinitions" | "renameReadlistDefinition" | "pinReadlistDefinition" | "unpinReadlistDefinition" | "moveReadlistArticles" | "purgeReadlistFitOverrides" | "deleteReadlistDefinition" | "now" | "requirePaidFeatures" | "setSmartReadlistRule"
	>,
	shared: ReadlistShared,
): Router {
	const router = express.Router();
	const { resolveReadlistContext, purgeArticleFromReadlistFor } = shared;

	const purgeReadlistArticles = async (params: {
		userId: UserId;
		readlist: ReadlistSlug;
	}): Promise<void> => {
		const deleteOne = purgeArticleFromReadlistFor(params.readlist);
		for (;;) {
			const { articles } = await deps.findReadlistArticles({
				userId: params.userId,
				readlist: params.readlist,
				pageSize: READLIST_PURGE_PAGE_SIZE,
				excludeContent: true,
			});
			if (articles.length === 0) return;
			for (const article of articles) {
				await deleteOne({ articleId: article.id, userId: params.userId });
			}
		}
	};

	const requirePaidFeaturesForSmart: RequestHandler = (req, res, next) => {
		if (ReadlistCreateBodySchema.parse(req.body).smart === undefined) {
			next();
			return;
		}
		deps.requirePaidFeatures(req, res, next);
	};

	router.post("/queues", requireNotLocked, requirePaidFeaturesForSmart, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const context = await resolveReadlistContext(req, userId);
		const body = ReadlistCreateBodySchema.parse(req.body);
		const label = body.label;
		const smartPurpose = body.smart === undefined ? undefined : parseReadlistPurpose(body.purpose) ?? null;
		const outcome =
			smartPurpose === null ? { status: "invalid-purpose" as const } : await deps.upsertReadlist({ userId, name: label });
		const refused = (reason: ReadlistCreateDialogRejection): ReadlistNaming => ({
			refusal: buildReadlistUrl(context.state, [["queue_error", `create_${reason}`]]),
			form: () =>
				renderReadlistCreateForm({
					popoverId: READLIST_CREATE_POPOVER_ID,
					key: "readlist-create",
					action: req.originalUrl,
					value: label,
					error: READLIST_CREATE_REJECTIONS[reason].message,
					hiddenFields: [],
					smart: { checked: body.smart !== undefined, purpose: body.purpose },
				}),
			siren: { code: reason, message: READLIST_CREATE_REJECTIONS[reason].message },
		});
		if (typeof smartPurpose === "string" && outcome.status === "ok" && outcome.created) {
			await deps.setSmartReadlistRule({
				userId,
				slug: outcome.readlist.slug,
				purpose: smartPurpose,
				effectiveAt: deps.now(),
			});
		}
		const naming = ((): ReadlistNaming => {
			switch (outcome.status) {
				case "ok":
					if (!outcome.created) return refused("name-taken");
					return {
						landing: buildReadlistUrl({ readlist: outcome.readlist.slug }),
						scroll: "top",
						siren: { location: readlistHref({ readlist: outcome.readlist.slug, readlistKey: readlistQueryKeyOf(req) }) },
					};
				case "invalid-name":
				case "reserved-name":
				case "invalid-purpose":
					return refused(outcome.status);
				case "limit-reached":
					return {
						landing: buildReadlistUrl(context.state, [["queue_error", READLIST_ERROR_LIMIT]]),
						scroll: "top",
						siren: { code: "limit-reached", message: READLIST_LIMIT_MESSAGE },
					};
			}
		})();

		answerReadlistNaming(req, res, { dialogId: READLIST_CREATE_POPOVER_ID, naming });
	});

	router.post(
		"/queues/:slug/rename",
		requireNotLocked,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const gone = buildReadlistUrl({}, [["queue_error", "rename_unknown-readlist"]]);
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success) {
				if (wantsSiren(req)) {
					refuseOverSiren(res, UNKNOWN_READLIST_REFUSAL);
					return;
				}
				res.redirect(303, gone);
				return;
			}
			const slug = requested.data;
			const label = typeof req.body?.label === "string" ? req.body.label : "";
			const answer = (naming: ReadlistNaming): void =>
				answerReadlistNaming(req, res, { dialogId: readlistRenamePopoverId(slug), naming });
			const definitions = await deps.listReadlistDefinitions(userId);
			const decision = decideReadlistRename({ slug, label, readlists: readerReadlists(definitions) });
			if (!decision.ok) {
				const { reason } = decision;
				if (reason === "unknown-readlist") {
					answer({ landing: gone, scroll: "top", siren: UNKNOWN_READLIST_REFUSAL });
					return;
				}
				answer({
					refusal: buildReadlistUrl({ readlist: slug }, [["queue_error", `rename_${reason}`]]),
					form: () =>
						renderReadlistRenameForm({
							slug,
							action: req.originalUrl,
							value: label,
							error: READLIST_RENAME_REJECTIONS[reason].message,
						}),
					siren: { code: reason, message: READLIST_RENAME_REJECTIONS[reason].message },
				});
				return;
			}
			const { renamed } = await deps.renameReadlistDefinition({
				userId,
				slug: decision.slug,
				label: decision.label,
			});
			if (!renamed) {
				answer({ landing: gone, scroll: "top", siren: UNKNOWN_READLIST_REFUSAL });
				return;
			}
			answer({
				landing: buildReadlistUrl({ readlist: decision.slug }),
				scroll: "top",
				announcement: `Readlist renamed to ${decision.label}.`,
				siren: { location: readlistHref({ readlist: decision.slug, readlistKey: readlistQueryKeyOf(req) }) },
			});
		},
	);

	router.post(
		"/queues/:slug/delete",
		requireNotLocked,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const context = await resolveReadlistContext(req, userId);
			const unknownReadlist = () => {
				if (wantsSiren(req)) {
					refuseOverSiren(res, UNKNOWN_READLIST_REFUSAL);
					return;
				}
				res.redirect(
					303,
					buildReadlistUrl({}, [["queue_error", READLIST_ERROR_UNKNOWN_READLIST]]),
				);
			};
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success) {
				unknownReadlist();
				return;
			}
			const decision = decideOwnedCustomReadlist({
				slug: requested.data,
				readlists: context.readlists,
			});
			if (!decision.ok) {
				unknownReadlist();
				return;
			}
			const requestedDestination = ReadlistSlugSchema.safeParse(req.body?.migrate_to);
			if (requestedDestination.success) {
				const migration = decideReadlistMigration({
					from: decision.slug,
					to: requestedDestination.data,
					readlists: context.readlists,
				});
				if (!migration.ok) {
					unknownReadlist();
					return;
				}
				await deps.moveReadlistArticles({ userId, from: migration.from, to: migration.to });
			}
			await purgeReadlistArticles({ userId, readlist: decision.slug });
			await deps.purgeReadlistFitOverrides({ userId, readlist: decision.slug });
			const { deleted } = await deps.deleteReadlistDefinition({ userId, slug: decision.slug });
			if (!deleted) {
				unknownReadlist();
				return;
			}
			const after = readlistAfterDelete({ viewed: context.activeReadlist.slug, deleted: decision.slug });
			res.redirect(303, wantsSiren(req) ? readlistHref({ readlist: after, readlistKey: readlistQueryKeyOf(req) }) : buildReadlistUrl({ readlist: after }));
		},
	);

	const readlistGone = buildReadlistUrl({}, [["queue_error", READLIST_ERROR_UNKNOWN_READLIST]]);

	const refuseUnknownReadlist = (req: Request, res: Response): void => {
		if (wantsSiren(req)) {
			refuseOverSiren(res, UNKNOWN_READLIST_REFUSAL);
			return;
		}
		res.redirect(303, readlistGone);
	};

	const landAfterPinToggle = (req: Request, res: Response, landing: { toggled: ReadlistSlug; viewed: ReadlistSlug }): void => {
		res.redirect(
			303,
			wantsSiren(req)
				? readlistHref({ readlist: landing.toggled, readlistKey: readlistQueryKeyOf(req) })
				: buildReadlistUrl({ readlist: landing.viewed }),
		);
	};

	router.post(
		"/queues/:slug/pin",
		requireNotLocked,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const context = await resolveReadlistContext(req, userId);
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success) {
				refuseUnknownReadlist(req, res);
				return;
			}
			const decision = decideReadlistPin({
				slug: requested.data,
				readlists: context.readlists,
				pinned: context.pinnedReadlists,
			});
			if (!decision.ok && decision.reason === "limit-reached") {
				if (wantsSiren(req)) {
					refuseOverSiren(res, PIN_LIMIT_REFUSAL);
					return;
				}
				res.redirect(303, buildReadlistUrl({ readlist: context.activeReadlist.slug }, [["queue_error", READLIST_ERROR_PIN_LIMIT]]));
				return;
			}
			if (!decision.ok) {
				refuseUnknownReadlist(req, res);
				return;
			}
			const { pinned } = await deps.pinReadlistDefinition({ userId, slug: decision.slug, pinnedAt: deps.now() });
			if (!pinned) {
				refuseUnknownReadlist(req, res);
				return;
			}
			landAfterPinToggle(req, res, { toggled: decision.slug, viewed: context.activeReadlist.slug });
		},
	);

	router.post(
		"/queues/:slug/unpin",
		requireNotLocked,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const context = await resolveReadlistContext(req, userId);
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success || requested.data === DEFAULT_READLIST_SLUG) {
				refuseUnknownReadlist(req, res);
				return;
			}
			const { unpinned } = await deps.unpinReadlistDefinition({ userId, slug: requested.data });
			if (!unpinned) {
				refuseUnknownReadlist(req, res);
				return;
			}
			landAfterPinToggle(req, res, { toggled: requested.data, viewed: context.activeReadlist.slug });
		},
	);

	return router;
}
