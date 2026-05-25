import { randomBytes } from "node:crypto";
import {
	IMPORT_SESSION_TTL_SECONDS,
	ImportSessionIdSchema,
} from "@packages/domain/import-session";
import type {
	ImportSession,
	ImportSessionStore,
} from "@packages/domain/import-session";

interface StoredSession {
	session: ImportSession;
	urls: readonly string[];
	deselected: Set<number>;
}

export function initInMemoryImportSession(deps: {
	now: () => Date;
}): ImportSessionStore {
	const sessions = new Map<string, StoredSession>();

	function load(id: string, userId: string): StoredSession | undefined {
		const row = sessions.get(id);
		if (!row) return undefined;
		if (row.session.userId !== userId) return undefined;
		if (row.session.expiresAt < Math.floor(deps.now().getTime() / 1000)) {
			sessions.delete(id);
			return undefined;
		}
		return row;
	}

	return {
		createImportSession: async ({ userId, urls, truncated, totalFound }) => {
			const id = ImportSessionIdSchema.parse(randomBytes(16).toString("hex"));
			const createdAt = deps.now().toISOString();
			const expiresAt = Math.floor(deps.now().getTime() / 1000) + IMPORT_SESSION_TTL_SECONDS;
			const deselected = new Set<number>();
			const session: ImportSession = {
				id,
				userId,
				createdAt,
				expiresAt,
				totalUrls: urls.length,
				totalFound,
				truncated,
				deselected,
			};
			sessions.set(id, { session, urls: [...urls], deselected });
			return session;
		},
		findImportSession: async ({ id, userId }) => {
			return load(id, userId)?.session;
		},
		loadImportSessionPage: async ({ id, userId, page, pageSize }) => {
			const row = load(id, userId);
			if (!row) return undefined;
			const start = (page - 1) * pageSize;
			const pageUrls = row.urls.slice(start, start + pageSize);
			return { session: row.session, pageUrls, page, pageSize };
		},
		loadAllImportSessionUrls: async ({ id, userId }) => {
			const row = load(id, userId);
			if (!row) return undefined;
			return row.urls;
		},
		toggleImportSelection: async ({ id, userId, index, checked }) => {
			const row = load(id, userId);
			if (!row) return;
			if (checked) {
				row.deselected.delete(index);
			} else {
				row.deselected.add(index);
			}
		},
		toggleAllImportSelection: async ({ id, userId, checked }) => {
			const row = load(id, userId);
			if (!row) return;
			if (checked) {
				row.deselected.clear();
			} else {
				for (let i = 0; i < row.session.totalUrls; i++) row.deselected.add(i);
			}
		},
		deleteImportSession: async ({ id, userId }) => {
			const row = load(id, userId);
			if (row) sessions.delete(id);
		},
	};
}
