import assert from "node:assert";
import {
	decideInboxRouting,
	EmailDeliveryModeSchema,
	type InboxAddressStore,
	type InboxRoutingRejection,
} from "@packages/domain/inbox";
import {
	DEFAULT_READLIST_SLUG,
	ReadlistFitOverrideIdSchema,
	ReadlistSlugSchema,
	decideReadlistPurpose,
	decideReadlistPurposeClear,
	type ReadlistPurposeRejection,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	ClearReadlistDefinitionPurpose,
	DeleteReadlistFitOverride,
	ListReadlistDefinitions,
	ListReadlistFitOverrides,
	SetReadlistDefinitionEmailDelivery,
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
import {
	EMAIL_DELIVERY_INVALID_ALERT,
	GMAIL_SELECTION_ALERT,
	GMAIL_UNAVAILABLE_ALERT,
	INBOX_UNAVAILABLE_ALERT,
} from "./readlist-alerts";
import type { ReadlistOnboarding } from "./readlist.component";
import { readerReadlists } from "./readlist-context";
import type { LoadReadlistGmailSenders } from "./readlist-gmail-senders.page";
import type { FindNonEmptyReadlists } from "./readlist-holdings";
import { answerReadlistNaming, type ReadlistNaming } from "./readlist-naming-answer";
import { READLIST_PREFERENCES_WIZARD_ID } from "./readlist-preferences-wizard.component";
import { ReadlistPreferencesPage, renderReadlistPurposeWizard } from "./readlist-preferences.component";
import { buildReadlistRail } from "./readlist-rail";
import { READLIST_ERROR_UNKNOWN_READLIST, READLIST_PURPOSE_INVALID_MESSAGE } from "./readlist.error";
import { buildReadlistUrl, readlistPreferencesPath } from "./readlist.url";
import { upgradeOfferFor } from "../../shared/upgrade-offer/upgrade-offer";
import { toSubscriptionBannerState } from "./readlist.viewmodel";

const PREFERENCES_ERROR_CODES = [
	"invalid-purpose",
	"unknown-inbox",
	"gmail-selection",
	"gmail-unavailable",
	"invalid-email-delivery",
] as const;

type PreferencesErrorCode = (typeof PREFERENCES_ERROR_CODES)[number];

interface PreferencesError {
	purposeError?: string;
	alert?: AlertContent;
}

const PREFERENCES_ERRORS: Record<PreferencesErrorCode, PreferencesError> = {
	"invalid-purpose": { purposeError: READLIST_PURPOSE_INVALID_MESSAGE },
	"unknown-inbox": { alert: INBOX_UNAVAILABLE_ALERT },
	"gmail-selection": { alert: GMAIL_SELECTION_ALERT },
	"gmail-unavailable": { alert: GMAIL_UNAVAILABLE_ALERT },
	"invalid-email-delivery": { alert: EMAIL_DELIVERY_INVALID_ALERT },
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

const EmailDeliveryBodySchema = z.object({ delivery: EmailDeliveryModeSchema });

export function initReadlistPreferencesRoutes(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose;
	setReadlistDefinitionEmailDelivery: SetReadlistDefinitionEmailDelivery;
	clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose;
	listReadlistFitOverrides: ListReadlistFitOverrides;
	deleteReadlistFitOverride: DeleteReadlistFitOverride;
	listInboxAddresses: InboxAddressStore["listAddressesByUserId"];
	setInboxAddressReadlist: InboxAddressStore["setAddressReadlist"];
	getEffectiveAccess: GetEffectiveAccess;
	buildBannerState: BuildBannerState;
	requireWriteAccess: RequestHandler;
	findNonEmptyReadlists: FindNonEmptyReadlists;
	now: () => Date;
	resolveOnboarding: (req: Request, userId: UserId, access: EffectiveAccess) => Promise<ReadlistOnboarding>;
	loadGmailSenders: LoadReadlistGmailSenders | undefined;
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
		const { loadGmailSenders } = deps;
		const [access, onboarding, inboxes, nonEmptyReadlists, choices, gmailSenders] = await Promise.all([
			accessPromise,
			accessPromise.then((resolved) => deps.resolveOnboarding(req, userId, resolved)),
			deps.listInboxAddresses(userId),
			deps.findNonEmptyReadlists({ userId, readlists }),
			deps.listReadlistFitOverrides({ userId, readlist: definition.slug }),
			loadGmailSenders === undefined
				? undefined
				: accessPromise.then((resolved) =>
					loadGmailSenders({
						userId,
						readlist: { slug: definition.slug, label: definition.label, purpose: definition.purpose },
						readlists,
						query: req.query,
						offer: upgradeOfferFor({ req, access: resolved }),
					}),
				),
		]);
		if (gmailSenders?.commandApplied) {
			if (req.get("HX-Request") !== "true") {
				res.redirect(303, gmailSenders.pageUrl);
				return;
			}
			res.set("HX-Push-Url", gmailSenders.pageUrl);
		}
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

		const offer = upgradeOfferFor({ req, access });

		sendComponent(
			req,
			res,
			Base(
				ReadlistPreferencesPage({
					readlist: { ...activeReadlist, purpose: definition.purpose, emailDelivery: definition.emailDelivery },
					rail: buildReadlistRail({
						context,
						accessIsReadOnly,
						offer,
						nonEmptyReadlists,
					}),
					values: { purpose: draft ?? definition.purpose },
					wizardOpen: draft !== undefined || error.purposeError !== undefined,
					inboxes,
					alert: error.alert,
					gmailSenders,
					choices,
					accessIsReadOnly,
					subscriptionBanner: toSubscriptionBannerState(access, deps.now(), offer),
					onboarding,
					query: req.query,
					purposeError: error.purposeError,
					cspNonce: requireCspNonce(req),
				}),
				await deps.buildBannerState(req, { preFetchedAccess: access, upgradeSource: "queue-preferences-banner" }),
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
			const typed = typeof req.body?.purpose === "string" ? req.body.purpose : "";
			const definitions = await deps.listReadlistDefinitions(userId);
			const rejections: Record<ReadlistPurposeRejection, () => ReadlistNaming> = {
				"unknown-readlist": () => unknownReadlistNaming,
				"invalid-purpose": () => ({
					refusal: `${readlistPreferencesPath(slug)}?preferences_error=invalid-purpose`,
					form: () => {
						assert(stored, "a purpose is refused only for a readlist the reader owns");
						return renderReadlistPurposeWizard({
							readlist: stored,
							values: { purpose: typed },
							error: READLIST_PURPOSE_INVALID_MESSAGE,
						}).popoverFormHtml;
					},
				}),
			};

			const stored = definitions.find((owned) => owned.slug === slug);
			if (typed.trim() === "" && stored?.purpose !== undefined) {
				const clearing = decideReadlistPurposeClear({ slug, readlists: readerReadlists(definitions) });
				assert(clearing.ok, "a readlist with a purpose is one the reader owns");
				const { cleared } = await deps.clearReadlistDefinitionPurpose({ userId, slug: clearing.slug });
				answer(cleared ? { landing: readlistPreferencesPath(clearing.slug), scroll: "stay-put" } : unknownReadlistNaming);
				return;
			}

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
			answer({ landing: readlistPreferencesPath(decision.slug), scroll: "stay-put" });
		},
	);

	router.post(
		"/queues/:slug/preferences/overrides/:id/delete",
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
			const definitions = await deps.listReadlistDefinitions(userId);
			if (!definitions.some((owned) => owned.slug === slug)) {
				unknownReadlist(res);
				return;
			}
			const id = ReadlistFitOverrideIdSchema.safeParse(req.params.id);
			if (id.success) {
				await deps.deleteReadlistFitOverride({ userId, readlist: slug, id: id.data });
			}
			res.redirect(303, readlistPreferencesPath(slug));
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
			const unavailableInbox = (): void => {
				res.redirect(
					303,
					`${readlistPreferencesPath(slug)}?preferences_error=unknown-inbox`,
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
			res.redirect(303, readlistPreferencesPath(slug));
		},
	);

	router.post(
		"/queues/:slug/preferences/email-delivery",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success || requested.data === DEFAULT_READLIST_SLUG) {
				unknownReadlist(res);
				return;
			}
			const slug = requested.data;
			const body = EmailDeliveryBodySchema.safeParse(req.body);
			if (!body.success) {
				res.redirect(303, `${readlistPreferencesPath(slug)}?preferences_error=invalid-email-delivery`);
				return;
			}
			const { updated } = await deps.setReadlistDefinitionEmailDelivery({
				userId,
				slug,
				emailDelivery: body.data.delivery,
			});
			if (!updated) {
				unknownReadlist(res);
				return;
			}
			res.redirect(303, readlistPreferencesPath(slug));
		},
	);

	return router;
}
