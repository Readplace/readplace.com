import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { SavedArticle } from "@packages/domain/article";

import { BULK_ARTICLE_JOB_PREFIX as BULK_PREFIX } from "@packages/article-store";
export const BULK_CHUNK_SIZE = 32;
export const BULK_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const BulkAction = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("file"), destination: ReadlistSlugSchema.refine(slug => slug !== DEFAULT_READLIST_SLUG), label: z.string().min(1), createdAt: z.iso.datetime() }),
	z.object({ kind: z.literal("read") }),
	z.object({ kind: z.literal("read-everywhere") }),
	z.object({ kind: z.literal("remove") }),
]);
export type BulkAction = z.infer<typeof BulkAction>;
const PREVIEW_RENEWAL_SECONDS = 3600;
const CONFIRMATION_WINDOW_SECONDS = 24 * 60 * 60;
export const SelectionSpec = z.object({
	discovery: z.object({ q: z.string().max(200).optional(), time: z.array(z.string()), saved: z.array(z.string()) }).optional(),
	source: z.enum(["all", "picked", "sender", "bulk", "unknown"]),
	sender: z.string().max(320).optional(),
	status: z.enum(["unread", "read"]),
	extent: z.enum(["page", "all"]),
	page: z.number().int().positive(),
	order: z.enum(["asc", "desc"]),
	action: BulkAction,
}).refine(spec => spec.source !== "sender" || Boolean(spec.sender));

export type SelectionSpec = z.infer<typeof SelectionSpec>;
export const BulkSelection = z.object({
	userId: UserIdSchema,
	id: z.uuid(),
	spec: SelectionSpec,
	createdAt: z.iso.datetime(),
	expiresAt: z.number().int(),
	generation: z.number().int().nonnegative(),
	failedState: z.enum(["preparing", "running", "restoring"]).optional(),
	state: z.enum(["preparing", "preview", "running", "completed", "restoring", "restored", "failed"]),
	cursor: z.string().optional(),
	selected: z.number().int().nonnegative(),
	completed: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	restoredCount: z.number().int().nonnegative().default(0),
	restorable: z.number().int().nonnegative(),
});
export type BulkSelection = z.infer<typeof BulkSelection>;
export const SelectionTarget = z.object({
	key: z.string(),
	url: z.string(),
	version: z.string(),
});
export type SelectionTarget = z.infer<typeof SelectionTarget>;

export function articleVersion(fields: {
	savedAt: string; status: string; statusRevision?: number; readAt?: string; personalPickedAt?: string; personalDecision?: string;
	viewedAt?: string; bulkSave?: boolean; provenance?: unknown; restoredAt?: unknown; relatedDismissedAt?: unknown;
	lastSummaryOpenedAt?: unknown; lastSummaryClosedAt?: unknown; relatedDismissedSuggestionId?: unknown; suggestionAttribution?: unknown;
}): string {
	return JSON.stringify([fields.savedAt, fields.status, fields.readAt, fields.personalPickedAt, fields.personalDecision,
		fields.viewedAt, fields.bulkSave || undefined, fields.provenance, fields.restoredAt, fields.relatedDismissedAt,
		fields.lastSummaryOpenedAt, fields.lastSummaryClosedAt, fields.relatedDismissedSuggestionId, fields.suggestionAttribution, ...(fields.statusRevision === undefined ? [] : [fields.statusRevision])], (_, value: unknown) => {
		if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
		return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
	});
}

export function selectionTarget(article: SavedArticle): SelectionTarget {
	const key = ArticleResourceUniqueId.parse(article.url).value;
	const version = articleVersion({ ...article, savedAt: article.savedAt.toISOString(), readAt: article.readAt?.toISOString(),
		personalPickedAt: article.personalPickedAt?.toISOString(), viewedAt: article.viewedAt?.toISOString() });
	return { key, url: article.url, version };
}

function confirmationDeadline(selection: Pick<BulkSelection, "spec" | "createdAt">): number | undefined {
	if (selection.spec.action.kind !== "read-everywhere") return undefined;
	return Math.floor(Date.parse(selection.createdAt) / 1000) + CONFIRMATION_WINDOW_SECONDS;
}

export function previewExpiry(selection: Pick<BulkSelection, "spec" | "createdAt">, now: Date): number {
	const renewed = Math.floor(now.getTime() / 1000) + PREVIEW_RENEWAL_SECONDS;
	const deadline = confirmationDeadline(selection);
	return deadline === undefined ? renewed : Math.min(renewed, deadline);
}

export function targetExpiry(selection: BulkSelection): number {
	const deadline = confirmationDeadline(selection);
	return (deadline ?? selection.expiresAt) + BULK_RETENTION_SECONDS;
}

export function headerExpiry(selection: BulkSelection): number {
	return Math.max(selection.expiresAt + BULK_RETENTION_SECONDS, targetExpiry(selection));
}

export function newSelection(userId: UserId, spec: SelectionSpec, now: Date): BulkSelection {
	const createdAt = now.toISOString();
	return {
		userId, id: randomUUID(), spec, createdAt, expiresAt: previewExpiry({ spec, createdAt }, now),
		generation: 0, state: "preparing", selected: 0, completed: 0, skipped: 0, failed: 0, restorable: 0, restoredCount: 0,
	};
}

export function selectionKey(userId: UserId, id: string) {
	return { userId, url: BULK_PREFIX + id };
}

export function targetKey(selection: BulkSelection, key: string) {
	const hash = createHash("sha256").update(key).digest("hex");
	return { userId: selection.userId, url: `${BULK_PREFIX + selection.id}/target/${hash}` };
}

export interface BulkSelectionStore {
	create(selection: BulkSelection): Promise<void>;
	get(userId: UserId, id: string): Promise<BulkSelection | undefined>;
	append(selection: BulkSelection, targets: readonly SelectionTarget[], nextCursor: string | undefined, now: Date): Promise<boolean>;
	fail(selection: BulkSelection): Promise<boolean>;
	retry(selection: BulkSelection): Promise<boolean>;
	restore(selection: BulkSelection, now: Date): Promise<boolean>;
	confirm(selection: BulkSelection, now: Date): Promise<boolean>;
}
