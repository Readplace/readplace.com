import assert from "node:assert";
import {
	decideInboxRouting,
	type InboxAddressStore,
	type InboxRoutingRejection,
} from "@packages/domain/inbox";
import {
	ReadlistSlugSchema,
	decideReadlistPurpose,
	decideReadlistPurposeClear,
	type ReadlistPurposeRejection,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	ClearReadlistDefinitionPurpose,
	ListReadlistDefinitions,
	SetReadlistDefinitionPurpose,
} from "@packages/provider-contracts/article-store";
import type { EffectiveAccess, GetEffectiveAccess } from "@packages/subscription-access";
import { requireCspNonce, sendComponent } from "@packages/web-shell";
import type { AlertContent } from "@packages/web-shell";
import express from "express";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";

import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { buildSaveTip } from "../../shared/save-tip/save-tip.component";
import { INBOX_UNAVAILABLE_ALERT } from "./readlist-alerts";
import type { ReadlistOnboarding } from "./readlist.component";
import { readerReadlists } from "./readlist-context";
import type { FindNonEmptyReadlists } from "./readlist-holdings";
import { answerReadlistNaming, type ReadlistNaming } from "./readlist-naming-answer";
import { preferencesUrl, readlistPreferencesEnabled } from "./readlist-preferences-feature";
import { READLIST_PREFERENCES_WIZARD_ID } from "./readlist-preferences-wizard.component";
import { ReadlistPreferencesPage, renderReadlistPurposeWizard } from "./readlist-preferences.component";
import { buildReadlistRail } from "./readlist-rail";
import { READLIST_ERROR_UNKNOWN_READLIST, READLIST_PURPOSE_INVALID_MESSAGE } from "./readlist.error";
import { buildReadlistUrl } from "./readlist.url";
import { toSubscriptionBannerState } from "./readlist.viewmodel";

const PREFERENCES_ERROR_CODES = ["invalid-purpose", "unknown-inbox"] as const;

type PreferencesErrorCode = (typeof PREFERENCES_ERROR_CODES)[number];

interface PreferencesError {
	purposeError?: string;
	inboxAlert?: AlertContent;
}

const PREFERENCES_ERRORS: Record<PreferencesErrorCode, PreferencesError> = {
	"invalid-purpose": { purposeError: READLIST_PURPOSE_INVALID_MESSAGE },
	"unknown-inbox": { inboxAlert: INBOX_UNAVAILABLE_ALERT },
};

const PreferencesQuerySchema = z.object({
	purpose: z.string().optional().catch(undefined),
	preferences_error: z.enum(PREFERENCES_ERROR_CODES).optional().catch(undefined),
});

const InboxRoutingBodySchema = z
	.object({
		address: z.string().catch(""),
		destination: z.string().catch(""),
	})
	.catch({ address: "", destination: "" });

export function initReadlistPreferencesRoutes(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose;
	clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose;
	listInboxAddresses: InboxAddressStore["listAddressesByUserId"];
	setInboxAddressReadlist: InboxAddressStore["setAddressReadlist"];
	getEffectiveAccess: GetEffectiveAccess;
	buildBannerState: BuildBannerState;
	requireWriteAccess: RequestHandler;
	findNonEmptyReadlists: FindNonEmptyReadlists;
	now: () => Date;
	resolveOnboarding: (req: Request, userId: UserId, access: EffectiveAccess) => Promise<ReadlistOnboarding>;
}): Router {
	const router = express.Router();

	const unknownReadlistUrl = buildReadlistUrl({}, [["queue_error", READLIST_ERROR_UNKNOWN_READLIST]]);

	const unknownReadlist = (res: Response): void => {
		res.redirect(303, unknownReadlistUrl);
	};

	const unknownReadlistNaming: ReadlistNaming = { landing: unknownReadlistUrl, scroll: "top" };

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
		const readlists = readerReadlists(definitions);
		const accessPromise = deps.getEffectiveAccess(userId);
		const [access, onboarding, inboxes, nonEmptyReadlists] = await Promise.all([
			accessPromise,
			accessPromise.then((resolved) => deps.resolveOnboarding(req, userId, resolved)),
			deps.listInboxAddresses(userId),
			deps.findNonEmptyReadlists({ userId, readlists }),
		]);
		const accessIsReadOnly = access.access === "read-only";
		const activeReadlist = { slug: definition.slug, label: definition.label };
		const context = {
			state: { readlist: definition.slug, tab: "queue", page: 1 } as const,
			activeReadlist,
			readlists,
		};
		const draft = parsed.purpose;
		const error: PreferencesError =
			parsed.preferences_error === undefined ? {} : PREFERENCES_ERRORS[parsed.preferences_error];

		sendComponent(
			req,
			res,
			Base(
				ReadlistPreferencesPage({
					readlist: { ...activeReadlist, purpose: definition.purpose },
					rail: buildReadlistRail({
						query: req.query,
						context,
						accessIsReadOnly,
						nonEmptyReadlists,
					}),
					values: { purpose: draft ?? definition.purpose },
					wizardOpen: draft !== undefined || error.purposeError !== undefined,
					inboxes,
					inboxAlert: error.inboxAlert,
					preferencesEnabled: readlistPreferencesEnabled(req.query),
					accessIsReadOnly,
					subscriptionBanner: toSubscriptionBannerState(access, deps.now()),
					onboarding,
					saveTip: buildSaveTip(req, { kind: "article", mode: "advisory" }),
					query: req.query,
					purposeError: error.purposeError,
					cspNonce: requireCspNonce(req),
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
			const answer = (naming: ReadlistNaming): void =>
				answerReadlistNaming(req, res, { dialogId: READLIST_PREFERENCES_WIZARD_ID, naming });
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success) {
				answer(unknownReadlistNaming);
				return;
			}
			const slug = requested.data;
			const enabled = readlistPreferencesEnabled(req.query);
			const typed = typeof req.body?.purpose === "string" ? req.body.purpose : "";
			const definitions = await deps.listReadlistDefinitions(userId);
			const rejections: Record<ReadlistPurposeRejection, () => ReadlistNaming> = {
				"unknown-readlist": () => unknownReadlistNaming,
				"invalid-purpose": () => ({
					refusal: preferencesUrl({
						slug,
						enabled,
						extra: [["preferences_error", "invalid-purpose"]],
					}),
					form: () => {
						const stored = definitions.find((owned) => owned.slug === slug);
						assert(stored, "a purpose is refused only for a readlist the reader owns");
						return renderReadlistPurposeWizard({
							readlist: stored,
							preferencesEnabled: enabled,
							values: { purpose: typed },
							error: READLIST_PURPOSE_INVALID_MESSAGE,
						}).popoverFormHtml;
					},
				}),
			};

			const decision = decideReadlistPurpose({
				slug,
				purpose: typed,
				readlists: readerReadlists(definitions),
			});
			if (!decision.ok) {
				answer(rejections[decision.reason]());
				return;
			}

			const { updated } = await deps.setReadlistDefinitionPurpose({
				userId,
				slug: decision.slug,
				purpose: decision.purpose,
			});
			if (!updated) {
				answer(unknownReadlistNaming);
				return;
			}
			answer({ landing: preferencesUrl({ slug: decision.slug, enabled }), scroll: "stay-put" });
		},
	);

	router.post(
		"/queues/:slug/preferences/purpose/delete",
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
			const decision = decideReadlistPurposeClear({
				slug: requested.data,
				readlists: readerReadlists(await deps.listReadlistDefinitions(userId)),
			});
			if (!decision.ok) {
				unknownReadlist(res);
				return;
			}

			const { cleared } = await deps.clearReadlistDefinitionPurpose({ userId, slug: decision.slug });
			if (!cleared) {
				unknownReadlist(res);
				return;
			}
			res.redirect(
				303,
				preferencesUrl({ slug: decision.slug, enabled: readlistPreferencesEnabled(req.query) }),
			);
		},
	);

	router.post(
		"/queues/:slug/preferences/inboxes",
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
			const unavailableInbox = (): void => {
				res.redirect(
					303,
					preferencesUrl({ slug, enabled, extra: [["preferences_error", "unknown-inbox"]] }),
				);
			};
			const rejections: Record<InboxRoutingRejection, () => void> = {
				"unknown-readlist": () => unknownReadlist(res),
				"unknown-inbox": unavailableInbox,
				"invalid-destination": unavailableInbox,
			};

			const body = InboxRoutingBodySchema.parse(req.body);
			const [definitions, inboxes] = await Promise.all([
				deps.listReadlistDefinitions(userId),
				deps.listInboxAddresses(userId),
			]);
			const decision = decideInboxRouting({
				slug,
				address: body.address,
				destination: body.destination,
				inboxes,
				readlists: readerReadlists(definitions),
			});
			if (!decision.ok) {
				rejections[decision.reason]();
				return;
			}

			await deps.setInboxAddressReadlist({
				userId,
				address: decision.address,
				readlist: decision.readlist,
			});
			res.redirect(303, preferencesUrl({ slug, enabled }));
		},
	);

	return router;
}
