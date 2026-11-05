import assert from "node:assert";
import { DEFAULT_READLIST_SLUG, type ReadlistRef, type ReadlistSlug, ReadlistSlugSchema, readerReadlists } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { parsePollParam, sendComponent } from "@packages/web-shell";
import express from "express";
import type { Request, RequestHandler, Response, Router } from "express";
import { HxRedirectPage } from "../../hx-redirect-page";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { parseGmailChecklistCommand } from "../integrations/gmail-checklist-command";
import type { StartGmailDiscovery } from "../integrations/gmail-discovery-start";
import type { GmailIntegrationDependencies } from "../integrations/gmail-integration.types";
import { renderGmailSenderResultsHtml, renderGmailSenderStatusHtml } from "../integrations/gmail-sender-widget.component";
import { GMAIL_DISCOVERY_MAX_POLLS } from "../integrations/gmail.url";
import { initReadReadlistGmailSources, type SaveReadlistGmailSenders, type SaveReadlistGmailSendersRejection } from "./readlist-gmail-senders.save";
import { buildReadlistGmailUrl, parseReadlistGmailSelection } from "./readlist-gmail-senders.url";
import { type ReadlistGmailSendersViewModel, readlistGmailPickerVisible, toReadlistGmailSenders } from "./readlist-gmail-senders.viewmodel";
import { READLIST_ERROR_UNKNOWN_READLIST } from "./readlist.error";
import { buildReadlistUrl, readlistPreferencesPath } from "./readlist.url";

export type LoadReadlistGmailSenders = (input: {
	userId: UserId;
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	readlists: readonly ReadlistRef[];
	query: Record<string, unknown>;
}) => Promise<ReadlistGmailSendersViewModel>;

export function initReadlistGmailSenders(deps: {
	gmail: GmailIntegrationDependencies;
	listReadlistDefinitions: ListReadlistDefinitions;
	getEffectiveAccess: GetEffectiveAccess;
	requireWriteAccess: RequestHandler;
	startGmailDiscovery: StartGmailDiscovery;
	save: SaveReadlistGmailSenders;
}): { load: LoadReadlistGmailSenders; routes: Router } {
	const { gmail } = deps;
	const readSources = initReadReadlistGmailSources({ gmail, getEffectiveAccess: deps.getEffectiveAccess });

	const load: LoadReadlistGmailSenders = async ({ userId, readlist, readlists, query }) => {
		const sources = await readSources(userId);
		const { command, listed } = parseGmailChecklistCommand(query);
		return toReadlistGmailSenders({
			...sources,
			userId,
			readlist,
			readlists,
			discoveredSenders: sources.pool.senders,
			detection: await gmail.detectNewsletters([...sources.pool.known]),
			selection: parseReadlistGmailSelection(query),
			command,
			listed,
			pollCount: parsePollParam(query.poll, GMAIL_DISCOVERY_MAX_POLLS),
		});
	};

	const router = express.Router();

	const unknownReadlistUrl = buildReadlistUrl({}, [["queue_error", READLIST_ERROR_UNKNOWN_READLIST]]);

	const ownerOf = (req: Request): UserId => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		return req.userId;
	};

	const ownedReadlist = async (req: Request) => {
		const requested = ReadlistSlugSchema.safeParse(req.params.slug);
		if (!requested.success || requested.data === DEFAULT_READLIST_SLUG) return undefined;
		const definitions = await deps.listReadlistDefinitions(ownerOf(req));
		const definition = definitions.find((owned) => owned.slug === requested.data);
		if (definition === undefined) return undefined;
		return { definition, readlists: readerReadlists(definitions) };
	};

	router.get("/queues/:slug/preferences/gmail/senders", async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		res.set("Cache-Control", "private, no-store");
		const owned = await ownedReadlist(req);
		if (owned === undefined) {
			res.redirect(303, unknownReadlistUrl);
			return;
		}
		const { definition, readlists } = owned;
		if (req.get("HX-Request") !== "true") {
			res.redirect(303, buildReadlistGmailUrl({ slug: definition.slug, selection: parseReadlistGmailSelection(req.query) }));
			return;
		}
		const vm = await load({
			userId,
			readlist: { slug: definition.slug, label: definition.label, purpose: definition.purpose },
			readlists,
			query: req.query,
		});
		if (vm.picker === undefined) {
			sendComponent(req, res, HxRedirectPage(readlistPreferencesPath(definition.slug)));
			return;
		}
		if (req.query.poll !== undefined) {
			res.type("html").send(renderGmailSenderStatusHtml(vm.picker.status, { outOfBandLoadButton: true }));
			return;
		}
		res.set("HX-Push-Url", vm.pageUrl);
		res.type("html").send(renderGmailSenderResultsHtml(vm.picker.results));
	});

	router.post(
		"/queues/:slug/preferences/gmail/discovery",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request, res: Response) => {
			const owned = await ownedReadlist(req);
			if (owned === undefined) {
				res.redirect(303, unknownReadlistUrl);
				return;
			}
			const slug = owned.definition.slug;
			const userId = ownerOf(req);
			const sources = await readSources(userId);
			if (!readlistGmailPickerVisible(sources.state)) {
				res.redirect(303, readlistPreferencesPath(slug));
				return;
			}
			const started = await deps.startGmailDiscovery(userId);
			assert(started.ok, "a visible picker implies the metadata scope discovery needs");
			const selection = parseReadlistGmailSelection(req.body);
			res.redirect(303, buildReadlistGmailUrl({
				slug,
				selection: { ...selection, edited: true, discoveryStarted: true, discoveryAfter: started.discoveryAfter },
			}));
		},
	);

	router.post(
		"/queues/:slug/preferences/gmail",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request, res: Response) => {
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success) {
				res.redirect(303, unknownReadlistUrl);
				return;
			}
			const slug = requested.data;
			const outcome = await deps.save({ userId: ownerOf(req), slug, body: req.body });
			const redirects: Record<"saved" | SaveReadlistGmailSendersRejection, string> = {
				saved: readlistPreferencesPath(slug),
				"unknown-readlist": unknownReadlistUrl,
				"gmail-selection": `${readlistPreferencesPath(slug)}?preferences_error=gmail-selection`,
				"gmail-unavailable": `${readlistPreferencesPath(slug)}?preferences_error=gmail-unavailable`,
			};
			res.redirect(303, redirects[outcome.ok ? "saved" : outcome.reason]);
		},
	);

	return { load, routes: router };
}
