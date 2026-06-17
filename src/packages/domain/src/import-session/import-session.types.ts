import type { UserId } from "../user/user.types";
import type { ImportSessionId } from "./import-session.schema";

export interface ImportLinksResult {
	readonly urls: readonly string[];
	readonly truncated: boolean;
	readonly totalFound: number;
}

export interface ImportSession {
	readonly id: ImportSessionId;
	/** Undefined for a session created by an anonymous visitor. Such sessions are
	 * accessible by capability (anyone holding the unguessable id), letting a
	 * logged-out user build a review and then sign up before committing. A session
	 * created while authenticated carries its owner's id and stays isolated to that
	 * owner. */
	readonly userId: UserId | undefined;
	readonly createdAt: string;
	readonly expiresAt: number;
	readonly totalUrls: number;
	readonly totalFound: number;
	readonly truncated: boolean;
	readonly deselected: ReadonlySet<number>;
}

export interface ImportSessionPage {
	readonly session: ImportSession;
	readonly pageUrls: readonly string[];
	readonly page: number;
	readonly pageSize: number;
}

export type CreateImportSession = (params: {
	userId: UserId | undefined;
	urls: readonly string[];
	truncated: boolean;
	totalFound: number;
}) => Promise<ImportSession>;

export type FindImportSession = (params: {
	id: ImportSessionId;
	userId: UserId | undefined;
}) => Promise<ImportSession | undefined>;

export type LoadImportSessionPage = (params: {
	id: ImportSessionId;
	userId: UserId | undefined;
	page: number;
	pageSize: number;
}) => Promise<ImportSessionPage | undefined>;

export type LoadAllImportSessionUrls = (params: {
	id: ImportSessionId;
	userId: UserId | undefined;
}) => Promise<readonly string[] | undefined>;

export type ToggleImportSelection = (params: {
	id: ImportSessionId;
	userId: UserId | undefined;
	index: number;
	checked: boolean;
}) => Promise<void>;

export type ToggleAllImportSelection = (params: {
	id: ImportSessionId;
	userId: UserId | undefined;
	checked: boolean;
}) => Promise<void>;

export type DeleteImportSession = (params: {
	id: ImportSessionId;
	userId: UserId | undefined;
}) => Promise<void>;

export interface ImportSessionStore {
	createImportSession: CreateImportSession;
	findImportSession: FindImportSession;
	loadImportSessionPage: LoadImportSessionPage;
	loadAllImportSessionUrls: LoadAllImportSessionUrls;
	toggleImportSelection: ToggleImportSelection;
	toggleAllImportSelection: ToggleAllImportSelection;
	deleteImportSession: DeleteImportSession;
}
