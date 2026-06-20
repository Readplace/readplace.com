import type { OAuthClient } from "@packages/domain/oauth";
import {
	OAuthClientIdSchema,
	computeOAuthClientDedupeKey,
	defaultOAuthClientName,
} from "@packages/domain/oauth";
import type {
	MarkOAuthClientActive,
	RegisterOAuthClient,
	RegisterOAuthClientInput,
	RegisteredOAuthClient,
} from "@packages/provider-contracts/oauth";

const IDLE_TTL_SECONDS = 48 * 60 * 60;
const ACTIVE_TTL_SECONDS = 365 * 24 * 60 * 60;

interface StoredClient {
	id: string;
	clientName: string;
	redirectUris: string[];
	grants: string[];
	tokenEndpointAuthMethod: string;
	clientIdIssuedAt: number;
	dedupeKey: string;
	expiresAt: number;
}

function toOAuthClient(row: StoredClient): RegisteredOAuthClient {
	return {
		id: OAuthClientIdSchema.parse(row.id),
		name: row.clientName,
		redirectUris: row.redirectUris,
		grants: row.grants,
		clientIdIssuedAt: row.clientIdIssuedAt,
		tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
	};
}

/** In-memory mirror of the DynamoDB dynamic client store, for dev and tests. */
export function initInMemoryOAuthClients(deps?: { now?: () => Date }): {
	getClient: (clientId: string) => Promise<OAuthClient | undefined>;
	registerClient: RegisterOAuthClient;
	markClientActive: MarkOAuthClientActive;
} {
	const now = deps?.now ?? (() => new Date());
	const nowSec = () => Math.floor(now().getTime() / 1000);
	const clients = new Map<string, StoredClient>();
	const pointers = new Map<string, string>();
	let counter = 0;

	function live(clientId: string): StoredClient | undefined {
		const row = clients.get(clientId);
		if (!row) return undefined;
		if (row.expiresAt <= nowSec()) return undefined;
		return row;
	}

	return {
		async getClient(clientId) {
			const row = live(clientId);
			return row ? toOAuthClient(row) : undefined;
		},
		async registerClient(input: RegisterOAuthClientInput): Promise<RegisteredOAuthClient> {
			const clientName = input.clientName ?? defaultOAuthClientName(input.redirectUris);
			const dedupeKey = computeOAuthClientDedupeKey({
				redirectUris: input.redirectUris,
				clientName,
				grants: input.grants,
				tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
			});
			const existingId = pointers.get(dedupeKey);
			if (existingId) {
				const existing = live(existingId);
				if (existing) return toOAuthClient(existing);
			}
			counter += 1;
			const id = `dyn-${counter}-${nowSec()}`;
			const row: StoredClient = {
				id,
				clientName,
				redirectUris: input.redirectUris,
				grants: input.grants,
				tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
				clientIdIssuedAt: nowSec(),
				dedupeKey,
				expiresAt: nowSec() + IDLE_TTL_SECONDS,
			};
			clients.set(id, row);
			pointers.set(dedupeKey, id);
			return toOAuthClient(row);
		},
		async markClientActive(clientId) {
			const row = live(clientId);
			if (!row) return;
			row.expiresAt = nowSec() + ACTIVE_TTL_SECONDS;
		},
	};
}
