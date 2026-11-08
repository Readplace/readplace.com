import assert from "node:assert";
import type { Router } from "express";
import express from "express";
import { initMapSenderToReadlist } from "../../../domain/gmail/resolve-readlist-mapping";
import { initStartGmailDiscovery } from "../integrations/gmail-discovery-start";
import { initSubmitNewsletterSenders } from "../integrations/gmail-submit-newsletter-senders";
import { initReadlistGmailSenders } from "./readlist-gmail-senders.page";
import { initReadReadlistGmailSources, initSaveReadlistGmailSenders } from "./readlist-gmail-senders.save";
import { initReadlistPreferencesRoutes } from "./readlist-preferences.page";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import { initReadlistShared } from "./readlist-shared";
import { initReaderPageRoutes } from "./reader-page.page";
import { initSaveRefusalTrackingRoutes } from "./save-refusal-tracking.page";
import { initReadlistListingRoutes } from "./readlist-listing.page";
import { initReadlistSaveRoutes } from "./readlist-save.page";
import { initReadlistQueueRoutes } from "./readlist-queues.page";
import { initReaderPanelRoutes } from "./reader-panels.page";
import { initHighlightNoteRoutes } from "./highlight-note.page";
import { initHighlightRoutes } from "./highlights.page";
import { initReadlistCardRoutes } from "./readlist-card.page";

export function initReadlistRoutes(deps: ReadlistDependencies): Router {
	const router = express.Router();
	const shared = initReadlistShared(deps);
	const { findNonEmptyReadlists, resolveOnboardingSignals } = shared;

	const readerPage = initReaderPageRoutes(
		{
			findArticleUrlById: deps.findArticleUrlById,
			findArticleByUrl: deps.findArticleByUrl,
			findItemOwner: deps.findItemOwner,
			presignMediaImage: deps.presignMediaImage,
			presignEnclosure: deps.presignEnclosure,
			findArticleById: deps.findArticleById,
			listUserSavesForUrl: deps.listUserSavesForUrl,
			appOrigin: deps.appOrigin,
			listIssueLinks: deps.listIssueLinks,
			findIssueLinkSaveStates: deps.findIssueLinkSaveStates,
			dualAuth: deps.dualAuth,
			listReadlistDefinitions: deps.listReadlistDefinitions,
			getOnboardingSignals: deps.getOnboardingSignals,
			now: deps.now,
			findRelatedArticles: deps.findRelatedArticles,
			logError: deps.logError,
			findPastReads: deps.findPastReads,
			resolveReaderProvenance: deps.resolveReaderProvenance,
			markdownBearerAuth: deps.markdownBearerAuth,
			buildBannerState: deps.buildBannerState,
			recordEngagementActivity: deps.recordEngagementActivity,
			findUserById: deps.findUserById,
			chromelessReader: deps.chromelessReader,
			findArticleCrawlVersions: deps.findArticleCrawlVersions,
			webReader: deps.webReader,
			resolveOwnedArticle: deps.resolveOwnedArticle,
			findArticleCrawlStatus: deps.findArticleCrawlStatus,
			findGeneratedSummary: deps.findGeneratedSummary,
			readArticleContent: deps.readArticleContent,
			requestResolutionOnView: deps.requestResolutionOnView,
			listArticleHighlights: deps.listArticleHighlights,
			readCanonicalSnapshot: deps.readCanonicalSnapshot,
			canSaveContent: deps.canSaveContent,
		},
		shared,
	);
	router.use(readerPage.router);
	router.use(
		initSaveRefusalTrackingRoutes({
			recordUngatedAnalyticsEvent: deps.recordUngatedAnalyticsEvent,
			now: deps.now,
			salt: deps.salt,
		}),
	);

	router.use(deps.dualAuth);
	router.use(deps.resolveVerificationStatus);
	router.use(
		initHighlightRoutes(
			{
				requireWriteAccess: deps.requireWriteAccess,
				readArticleContent: deps.readArticleContent,
				readCanonicalSnapshot: deps.readCanonicalSnapshot,
				createReaderHighlight: deps.createReaderHighlight,
				deleteHighlight: deps.deleteHighlight,
				recordAnalyticsEvent: deps.recordAnalyticsEvent,
				salt: deps.salt,
				now: deps.now,
				appOrigin: deps.appOrigin,
			},
			{
				findOwnedArticle: (req, id) => {
					assert(req.userId, "userId required - route must be protected by requireAuth");
					return shared.storeFor(shared.requestReadlistContext(req).state.readlist).findArticleById(id, req.userId);
				},
				renderOwnerReader: readerPage.renderOwnerReader,
				readerSectionFor: shared.ownerReaderSection,
			},
		),
	);
	router.use(
		initHighlightNoteRoutes(
			{
				requireWriteAccess: deps.requireWriteAccess,
				updateHighlightNote: deps.updateHighlightNote,
				recordAnalyticsEvent: deps.recordAnalyticsEvent,
				salt: deps.salt,
				now: deps.now,
			},
			{
				findOwnedArticle: (req, id) => {
					assert(req.userId, "userId required - route must be protected by requireAuth");
					return shared.storeFor(shared.requestReadlistContext(req).state.readlist).findArticleById(id, req.userId);
				},
			},
		),
	);

	const { gmail } = deps;
	const readlistGmail =
		gmail === undefined
			? undefined
			: initReadlistGmailSenders({
				gmail,
				listReadlistDefinitions: deps.listReadlistDefinitions,
				getEffectiveAccess: deps.getEffectiveAccess,
				requireWriteAccess: deps.requireWriteAccess,
				startGmailDiscovery: initStartGmailDiscovery({ gmail }),
				save: initSaveReadlistGmailSenders({
					gmail,
					listReadlistDefinitions: deps.listReadlistDefinitions,
					readSources: initReadReadlistGmailSources({ gmail, getEffectiveAccess: deps.getEffectiveAccess }),
					mapSenderToReadlist: initMapSenderToReadlist({
						mappings: gmail.gmailMappingStore,
						getOrCreateReadlistAddress: gmail.getOrCreateReadlistAddress,
						cancelGmailHistoryImports: gmail.cancelGmailHistoryImports,
					}),
					submitNewsletterSenders: initSubmitNewsletterSenders(gmail),
				}),
			});
	if (readlistGmail !== undefined) {
		router.use(readlistGmail.routes);
	}

	router.use(
		initReadlistPreferencesRoutes({
			listReadlistDefinitions: deps.listReadlistDefinitions,
			setReadlistDefinitionPurpose: deps.setReadlistDefinitionPurpose,
			clearReadlistDefinitionPurpose: deps.clearReadlistDefinitionPurpose,
			listReadlistFitOverrides: deps.listReadlistFitOverrides,
			deleteReadlistFitOverride: deps.deleteReadlistFitOverride,
			listInboxAddresses: deps.listInboxAddresses,
			setInboxAddressReadlist: deps.setInboxAddressReadlist,
			getEffectiveAccess: deps.getEffectiveAccess,
			buildBannerState: deps.buildBannerState,
			requireWriteAccess: deps.requireWriteAccess,
			findNonEmptyReadlists,
			now: deps.now,
			resolveOnboarding: async (req, userId, access) =>
				(await resolveOnboardingSignals(req, userId, access)).onboarding,
			loadGmailSenders: readlistGmail?.load,
		}),
	);

	router.use(
		initReadlistListingRoutes(
			{
				now: deps.now,
				setKeepOfferDismissed: deps.setKeepOfferDismissed,
				recordNativeAppAnyActivity: deps.recordNativeAppAnyActivity,
				findArticleCrawlStatuses: deps.findArticleCrawlStatuses,
				logError: deps.logError,
				findGeneratedSummaries: deps.findGeneratedSummaries,
				findUserById: deps.findUserById,
				httpErrorMessageMapping: deps.httpErrorMessageMapping,
				findGmailConnectionByUserId: deps.findGmailConnectionByUserId,
				getEffectiveAccess: deps.getEffectiveAccess,
				recordEmailStepMarkedDone: deps.recordEmailStepMarkedDone,
				requireWriteAccess: deps.requireWriteAccess,
				recordGmailStepDismissed: deps.recordGmailStepDismissed,
				secureCookies: deps.secureCookies,
			},
			shared,
		),
	);
	router.use(
		initReadlistSaveRoutes(
			{
				saveArticleKeepingPosition: deps.saveArticleKeepingPosition,
				saveArticleWithoutActivity: deps.saveArticleWithoutActivity,
				recordNativeAppSavedArticle: deps.recordNativeAppSavedArticle,
				secureCookies: deps.secureCookies,
				recordAnalyticsEvent: deps.recordAnalyticsEvent,
				now: deps.now,
				salt: deps.salt,
				publishSubmitLink: deps.publishSubmitLink,
				putPendingPdf: deps.putPendingPdf,
				publishSaveLinkRawPdfCommand: deps.publishSaveLinkRawPdfCommand,
				readPendingUploadPrefix: deps.readPendingUploadPrefix,
				putPendingHtml: deps.putPendingHtml,
				publishSaveLinkRawHtmlCommand: deps.publishSaveLinkRawHtmlCommand,
				requireWriteAccess: deps.requireWriteAccess,
				validateNewSaveUrl: deps.validateNewSaveUrl,
				findArticlesByUser: deps.findArticlesByUser,
				findArticleCrawlStatuses: deps.findArticleCrawlStatuses,
				logError: deps.logError,
				findGeneratedSummaries: deps.findGeneratedSummaries,
				refreshArticleIfStale: deps.refreshArticleIfStale,
				fileArticleIntoReadlist: deps.fileArticleIntoReadlist,
				refreshArticleIfStaleStored: deps.refreshArticleIfStaleStored,
				findSavedUrls: deps.findSavedUrls,
				allocateSavedAtSequence: deps.allocateSavedAtSequence,
				recordEngagementActivity: deps.recordEngagementActivity,
				allocateSavedAt: deps.allocateSavedAt,
				validateSaveableUrl: deps.validateSaveableUrl,
				statPendingUpload: deps.statPendingUpload,
				resolveSaveIdentity: deps.resolveSaveIdentity,
				createUploadSlot: deps.createUploadSlot,
				updateArticleStatus: deps.updateArticleStatus,
				markCrawlPending: deps.markCrawlPending,
				markSummaryPending: deps.markSummaryPending,
				pinContentSource: deps.pinContentSource,
				publishUpdateFetchTimestamp: deps.publishUpdateFetchTimestamp,
				publishLinkSaved: deps.publishLinkSaved,
				publishLinkQueued: deps.publishLinkQueued,
				publishQueueEntryCreated: deps.publishQueueEntryCreated,
				publishComputeRelatedPasses: deps.publishComputeRelatedPasses,
				publishComputeRelatedPastReads: deps.publishComputeRelatedPastReads,
				readRelatedPassRequestState: deps.readRelatedPassRequestState,
				markRelatedPassesRequested: deps.markRelatedPassesRequested,
			},
			shared,
		),
	);
	router.use(
		initReadlistQueueRoutes(
			{
				findReadlistArticles: deps.findReadlistArticles,
				requireWriteAccess: deps.requireWriteAccess,
				upsertReadlist: deps.upsertReadlist,
				listReadlistDefinitions: deps.listReadlistDefinitions,
				renameReadlistDefinition: deps.renameReadlistDefinition,
				moveReadlistArticles: deps.moveReadlistArticles,
				purgeReadlistFitOverrides: deps.purgeReadlistFitOverrides,
				deleteReadlistDefinition: deps.deleteReadlistDefinition,
			},
			shared,
		),
	);
	router.use(
		initReaderPanelRoutes(
			{
				findArticleById: deps.findArticleById,
				markArticleViewed: deps.markArticleViewed,
				now: deps.now,
				resolveReaderProvenance: deps.resolveReaderProvenance,
				findRelatedArticles: deps.findRelatedArticles,
				logError: deps.logError,
				markRelatedDismissed: deps.markRelatedDismissed,
				findIssueLink: deps.findIssueLink,
				validateNewSaveUrl: deps.validateNewSaveUrl,
				requireWriteAccess: deps.requireWriteAccess,
				refreshArticleIfStale: deps.refreshArticleIfStale,
				publishSubmitLink: deps.publishSubmitLink,
				appOrigin: deps.appOrigin,
				findPastReads: deps.findPastReads,
				publishComputeRelatedPastReads: deps.publishComputeRelatedPastReads,
				publishComputeRelatedPasses: deps.publishComputeRelatedPasses,
				readRelatedPassRequestState: deps.readRelatedPassRequestState,
				markRelatedPassesRequested: deps.markRelatedPassesRequested,
				recordEngagementActivity: deps.recordEngagementActivity,
				markSummaryToggled: deps.markSummaryToggled,
				recordAnalyticsEvent: deps.recordAnalyticsEvent,
				salt: deps.salt,
				listArticleHighlights: deps.listArticleHighlights,
				readCanonicalSnapshot: deps.readCanonicalSnapshot,
				canSaveContent: deps.canSaveContent,
			},
			shared,
		),
	);
	router.use(
		initReadlistCardRoutes(
			{
				appOrigin: deps.appOrigin,
				findArticleById: deps.findArticleById,
				findArticleCrawlStatus: deps.findArticleCrawlStatus,
				findGeneratedSummary: deps.findGeneratedSummary,
				resolveReaderProvenance: deps.resolveReaderProvenance,
				getOnboardingSignals: deps.getOnboardingSignals,
				getEffectiveAccess: deps.getEffectiveAccess,
				now: deps.now,
				recordMarkReadAcrossQueuesAcknowledged:
					deps.recordMarkReadAcrossQueuesAcknowledged,
				updateArticleStatusAcrossReadlists:
					deps.updateArticleStatusAcrossReadlists,
				recordEngagementActivity: deps.recordEngagementActivity,
				recordAnalyticsEvent: deps.recordAnalyticsEvent,
				salt: deps.salt,
				recordDeleteArticleAcknowledged: deps.recordDeleteArticleAcknowledged,
				requireWriteAccess: deps.requireWriteAccess,
				addArticleToReadlist: deps.addArticleToReadlist,
				listReadlistDefinitions: deps.listReadlistDefinitions,
				listUserSavesForUrls: deps.listUserSavesForUrls,
				upsertReadlist: deps.upsertReadlist,
				findArticleUrlById: deps.findArticleUrlById,
				listUserSavesForUrl: deps.listUserSavesForUrl,
				publishRemoveMyContent: deps.publishRemoveMyContent,
			},
			shared,
		),
	);

	return router;
}
