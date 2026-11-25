import { toEventInstant } from "@packages/domain/event-envelope";
import { ReaderArticleHashId, readlistFilterOf, resolveArticleDiscovery } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { computeVerificationStatus } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { PublishLinkDequeued, PublishLinkQueued } from "@packages/provider-contracts/events";
import type { UserId } from "@packages/domain/user";
import type { AssignSavedArticleToReadlist, FindArticlesByUser, FindReadlistRemoval, ListReadlistDefinitions, ListUserSavesForUrl, UpdateArticleStatus } from "@packages/provider-contracts/article-store";
import type { BulkArticleOperations } from "../web/pages/readlist/bulk-articles.page";
import { newsletterSourceStore, type NewsletterSourceDependencies } from "../web/pages/readlist/newsletter-source";
import { BULK_CHUNK_SIZE, BULK_RETENTION_SECONDS, selectionTarget, type BulkSelection, type SelectionTarget } from "./selection";
import { initInMemoryBulkSelections } from "./selection-store";

export function initLocalBulkOperations(deps: NewsletterSourceDependencies & {
	articles: {
		findArticlesByUser: FindArticlesByUser;
		findReadlistRemoval: FindReadlistRemoval;
		listReadlistDefinitions: ListReadlistDefinitions;
		assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
		updateArticleStatus: UpdateArticleStatus;
		listUserSavesForUrl: ListUserSavesForUrl;
		holdBulkArticle(userId: UserId, url: string, now: Date): (() => boolean) | undefined;
	};
	findUserById: FindUserById; now: () => Date;
	publishLinkQueued: PublishLinkQueued; publishLinkDequeued: PublishLinkDequeued;
}): BulkArticleOperations {
	const store = initInMemoryBulkSelections();
	const recovery = new Map<string, { restore: () => boolean; expires: number }>();
	const busy = new Set<string>();
	async function apply(job: BulkSelection, target: SelectionTarget) {
		const { userId, spec: { action } } = job;
		const now = deps.now();
		const user = await deps.findUserById(userId);
		const restoring = job.state === "restoring";
		const handle = JSON.stringify([userId, job.id, target.key]);
		const creates = restoring || action.kind === "file";
		const allowed = user && !user.deletedAt && !user.ageLockedAt && (!creates || user.emailVerified || computeVerificationStatus({ registeredAt: user.registeredAt, now }).state !== "locked");
		if (restoring) {
			const held = recovery.get(handle);
			if (!held) return;
			recovery.delete(handle);
			job.restorable--;
			if (allowed && held.expires > now.getTime() && held.restore()) {
				await deps.publishLinkQueued({ userId, url: target.url });
				job.restoredCount++;
			} else job.skipped++;
			return;
		}
		const id = ReaderArticleHashId.fromResourceUniqueId(target.key);
		const article = await deps.findArticleById(id, userId);
		if (!allowed || !article || selectionTarget(article).version !== target.version) { job.skipped++; return; }
		if (action.kind === "file") {
			const removedAt = await deps.articles.findReadlistRemoval({ userId, readlist: action.destination, url: target.url });
			if (removedAt && removedAt >= toEventInstant(new Date(job.createdAt))) { job.skipped++; return; }
			const exists = (await deps.articles.listReadlistDefinitions(userId)).some(list => list.slug === action.destination && list.createdAt.toISOString() === action.createdAt);
			if (!exists || !(await deps.articles.assignSavedArticleToReadlist({ userId, readlist: action.destination, from: DEFAULT_READLIST_SLUG, url: target.url, savedAt: now })).assigned) { job.skipped++; return; }
		} else if (action.kind === "read") {
			if (article.status !== "unread" || !await deps.articles.updateArticleStatus(id, userId, "read")) { job.skipped++; return; }
		} else {
			const restore = deps.articles.holdBulkArticle(userId, target.url, now);
			if (!restore) { job.skipped++; return; }
			recovery.set(handle, { restore, expires: now.getTime() + BULK_RETENTION_SECONDS * 1000 });
			job.restorable++;
			if (!(await deps.articles.listUserSavesForUrl({ userId, url: target.url })).length) await deps.publishLinkDequeued({ userId, url: target.url });
		}
		job.completed++;
	}
	return { store, async dispatch({ userId, id, generation, intent }) {
		const job = await store.get(userId, id);
		if (!job || busy.has(id) || generation !== job.generation || job.expiresAt <= Math.floor(deps.now().getTime() / 1000)) return;
		busy.add(id);
		try {
			if (intent === "confirm") await store.confirm(job, deps.now());
			if (intent === "restore") await store.restore(job, deps.now());
			if (intent === "retry") await store.retry(job);
			let current = await store.get(userId, id);
			if (!current) return;
			if (current.state === "preparing") {
				const spec = current.spec;
				const list = spec.source === "sender" ? newsletterSourceStore(deps, spec.sender).findArticlesByUser : deps.articles.findArticlesByUser;
				const discovery = spec.discovery && resolveArticleDiscovery({ ...readlistFilterOf(spec.discovery), q: spec.discovery.q, now: new Date(current.createdAt) });
				let page = 1;
				while (current?.state === "preparing") {
					const rows = await list({ userId, status: spec.status, page, pageSize: BULK_CHUNK_SIZE, order: spec.order,
						discovery, personalScope: spec.source === "picked" ? "picked" : undefined, managedOrigin: spec.source === "unknown" || spec.source === "bulk" ? spec.source : undefined });
					await store.append(current, rows.articles.filter(item => item.savedAt.toISOString() <= job.createdAt).map(selectionTarget), rows.hasMore ? String(++page) : undefined, deps.now());
					current = await store.get(userId, id);
				}
			} else if (current.state === "running" || current.state === "restoring") {
				const progress = { ...current };
				for (const target of store.listTargets(current)) await apply(progress, target);
				store.checkpoint({ ...progress, generation: progress.generation + 1, state: current.state === "restoring" ? "restored" : "completed" });
			}
		} finally { busy.delete(id); }
	} };
}
