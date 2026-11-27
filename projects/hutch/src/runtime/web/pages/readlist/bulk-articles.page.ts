import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { z } from "zod";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render, sendComponent, toAbsoluteDateTime, withInternalTracking } from "@packages/web-shell";
import { Base } from "../../base.component";
import { newSelection, selectionTarget, SelectionSpec, type BulkSelectionStore, type BulkSelection } from "../../../bulk-articles/selection";
import type { UserId } from "@packages/domain/user";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import type { ReadlistShared } from "./readlist-shared";
import { READLIST_PAGE_SIZE } from "./readlist-page-size";
import { tabLabel, tabQuery } from "./readlist.tabs";
import { isAccountLocked } from "../../middleware/require-not-locked.middleware";

export interface BulkArticleOperations {
	store: BulkSelectionStore;
	readEverywhere: boolean;
	dispatch(detail: { userId: UserId; id: string; generation: number; intent?: "confirm" | "restore" | "retry" }): Promise<void>;
}

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);
const form = z.object({ extent: z.enum(["page", "all"]), action: z.string().min(1), visible: z.union([z.string(), z.array(z.string()).max(READLIST_PAGE_SIZE)]).optional() });
const href = (job: BulkSelection) => `/queue/manage/${job.id}`;
function availableOperation(job: BulkSelection) {
	if (job.state === "preview" && job.selected > 0) return "confirm";
	if (job.state === "completed" && job.restorable > 0) return "restore";
	if (job.state === "failed") return "retry";
	return undefined;
}

const statusTemplate = readFileSync(join(__dirname, "bulk-articles.template.html"), "utf-8");
const staleFormTemplate = readFileSync(join(__dirname, "bulk-articles-stale-form.template.html"), "utf-8");
const statusStyles = readFileSync(join(__dirname, "bulk-articles.styles.css"), "utf-8");

export function bulkArticleRoutes(deps: ReadlistDependencies, shared: ReadlistShared, ops: BulkArticleOperations): express.Router {
	const router = express.Router();
	router.post("/manage/preview", express.urlencoded({ extended: false }), async (req, res) => {
		assert(req.userId);
		const input = form.safeParse(req.body);
		const filters = (await shared.resolveReadlistContext(req, req.userId)).state;
		if (!input.success || filters.readlist !== DEFAULT_READLIST_SLUG) { res.sendStatus(400); return; }
		const { action, extent, visible } = input.data;
		if (action.startsWith("file/") && isAccountLocked(req)) { res.sendStatus(403); return; }
		const destination = action.startsWith("file/") && (await deps.listReadlistDefinitions(req.userId)).find(list => list.slug === action.slice(5));
		const tab = tabQuery(filters.tab);
		if (action === "read-everywhere" && (!ops.readEverywhere || tab.status !== "unread")) {
			sendComponent(req, res, Base({ seo: { title: t("manage.title"), description: t("manage.title"), canonicalUrl: "/queue", robots: "noindex, nofollow" },
				statusCode: 409, styles: statusStyles, content: { html: render(staleFormTemplate, { title: t("manage.title"), message: t("manage.staleForm"), back: t("manage.back"),
					backHref: withInternalTracking("/queue", { source: "manage-articles", content: "stale-form" }) }) } }, await deps.buildBannerState(req)));
			return;
		}
		const spec = SelectionSpec.safeParse({ source: filters.managedSource ?? "all", sender: filters.sender, extent, page: filters.page,
			discovery: filters.discovery, status: tab.status, order: filters.order ?? tab.defaultOrder,
			action: destination ? { kind: "file", destination: destination.slug, label: destination.label, createdAt: destination.createdAt.toISOString() } : { kind: action } });
		if (!spec.success) { res.sendStatus(400); return; }
		const job = newSelection(req.userId, spec.data, deps.now());
		await ops.store.create(job);
		if (extent === "page") {
			const listed = new Set(typeof visible === "string" ? [visible] : visible);
			const store = shared.storeFor(filters.readlist, filters.managedSource, filters.sender);
			const page = await store.findArticlesByUser({ userId: req.userId, status: tab.status, sort: tab.sort, order: spec.data.order,
				page: filters.page, pageSize: READLIST_PAGE_SIZE, discovery: shared.storeDiscoveryOf(filters) });
			await ops.store.append(job, page.articles.filter(article => listed.has(article.id.value)).map(selectionTarget), undefined, deps.now());
		} else await ops.dispatch({ userId: req.userId, id: job.id, generation: job.generation });
		res.redirect(303, href(job));
	});
	router.get("/manage/:id", async (req, res) => {
		assert(req.userId);
		const id = z.uuid().safeParse(req.params.id);
		const job = id.success ? await ops.store.get(req.userId, id.data) : undefined;
		if (!job) { res.sendStatus(404); return; }
		if (job.expiresAt <= Math.floor(deps.now().getTime() / 1000)) { res.sendStatus(410); return; }
		const operation = availableOperation(job);
		const unfinished = job.spec.action.kind === "read-everywhere" && job.state === "failed" && job.failedState === "running";
		const html = render(statusTemplate, {
			title: t("manage.title"), action: t(`manage.action.${job.spec.action.kind}`), destination: job.spec.action.kind === "file" ? job.spec.action.label : undefined,
			extent: t(`manage.extent.${job.spec.extent}`), source: job.spec.sender ?? t(`manage.${job.spec.source}`),
			tab: job.spec.status === "unread" ? tabLabel("queue") : tabLabel("done"),
			deadline: operation === "confirm" ? t("manage.confirmBy") : operation === "restore" ? t("manage.restoreBy") : undefined,
			expiresAt: toAbsoluteDateTime({ iso: new Date(job.expiresAt * 1000).toISOString() }), state: t(`manage.state.${job.state}`), href: href(job), operation,
			button: operation && t(`manage.${operation}`), active: ["running", "preparing", "restoring"].includes(job.state),
			operationHref: operation && withInternalTracking(`${href(job)}/${operation}`, { source: "manage-articles", content: operation }),
			refreshHref: withInternalTracking(href(job), { source: "manage-articles", content: "refresh" }),
			backHref: withInternalTracking("/queue", { source: "manage-articles", content: "back" }),
			refresh: t("manage.refresh"), back: t("manage.back"), counts: (["selected", "completed", "skipped", "failed", "restorable", "restoredCount"] as const)
				.map(name => ({ label: t(`manage.count.${unfinished && name === "failed" ? "unfinished" : name}`), count: job[name] })),
		});
		res.set("Cache-Control", "private, no-store");
		sendComponent(req, res, Base({ seo: { title: t("manage.title"), description: t("manage.title"), canonicalUrl: href(job), robots: "noindex, nofollow" },
			styles: statusStyles, content: { html } }, await deps.buildBannerState(req)));
	});
	router.post("/manage/:id/:intent", async (req, res) => {
		assert(req.userId);
		const intent = z.enum(["confirm", "restore", "retry"]).safeParse(req.params.intent);
		const id = z.uuid().safeParse(req.params.id);
		const job = id.success ? await ops.store.get(req.userId, id.data) : undefined;
		if (!job || !intent.success) { res.sendStatus(404); return; }
		if (job.expiresAt <= Math.floor(deps.now().getTime() / 1000)) { res.sendStatus(410); return; }
		if (intent.data !== availableOperation(job)) { res.sendStatus(409); return; }
		if (isAccountLocked(req) && (intent.data === "restore" || job.spec.action.kind === "file")) { res.sendStatus(403); return; }
		// Publish first so a crash on either side of the conditional transition leaves a durable command.
		await ops.dispatch({ userId: req.userId, id: job.id, generation: job.generation, intent: intent.data });
		if (intent.data === "confirm") await ops.store.confirm(job, deps.now());
		if (intent.data === "restore") await ops.store.restore(job, deps.now());
		if (intent.data === "retry") await ops.store.retry(job);
		res.redirect(303, href(job));
	});
	return router;
}
