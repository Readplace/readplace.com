import { randomBytes } from "node:crypto";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
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

const ClientRow = z.object({
	pk: z.string(),
	clientId: z.string(),
	clientName: z.string(),
	redirectUris: z.array(z.string()),
	grants: z.array(z.string()),
	tokenEndpointAuthMethod: z.string(),
	clientIdIssuedAt: z.number(),
	dedupeKey: z.string(),
	expiresAt: z.number(),
});

const PointerRow = z.object({
	pk: z.string(),
	clientId: z.string(),
	expiresAt: z.number(),
});

/**
 * A registration that never completes a token exchange self-expires in 48h, so
 * the churn from clients that register-then-abandon (the connector that probes
 * and walks away) clears itself without a global cap that an attacker could fill
 * to deny everyone else.
 */
const IDLE_TTL_SECONDS = 48 * 60 * 60;
/**
 * On first — and every subsequent — token issuance the row extends to a year,
 * comfortably past the 180-day refresh-token lifetime so a live refresh token
 * can never outlive the client row it resolves through.
 */
const ACTIVE_TTL_SECONDS = 365 * 24 * 60 * 60;

function toEpochSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

const clientKey = (clientId: string): string => `client#${clientId}`;
const pointerKey = (dedupeKey: string): string => `clientdedupe#${dedupeKey}`;

function toOAuthClient(row: z.infer<typeof ClientRow>): RegisteredOAuthClient {
	return {
		id: OAuthClientIdSchema.parse(row.clientId),
		name: row.clientName,
		redirectUris: row.redirectUris,
		grants: row.grants,
		clientIdIssuedAt: row.clientIdIssuedAt,
		tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
	};
}

export function initDynamoDbOAuthClients(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
	now: () => Date;
}): {
	getClient: (clientId: string) => Promise<OAuthClient | undefined>;
	registerClient: RegisterOAuthClient;
	markClientActive: MarkOAuthClientActive;
} {
	const { client, tableName, now } = deps;
	const clients = defineDynamoTable({ client, tableName, schema: ClientRow });
	const pointers = defineDynamoTable({ client, tableName, schema: PointerRow });

	async function getLiveClientRow(
		clientId: string,
	): Promise<z.infer<typeof ClientRow> | undefined> {
		const row = await clients.get({ pk: clientKey(clientId) });
		if (!row) return undefined;
		// DynamoDB TTL deletion lags by minutes, so enforce expiry on read rather
		// than trusting the row's absence.
		if (row.expiresAt <= toEpochSeconds(now())) return undefined;
		return row;
	}

	return {
		async getClient(clientId) {
			const row = await getLiveClientRow(clientId);
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

			const pointer = await pointers.get({ pk: pointerKey(dedupeKey) });
			if (pointer) {
				const existing = await getLiveClientRow(pointer.clientId);
				if (existing) return toOAuthClient(existing);
			}

			const nowSec = toEpochSeconds(now());
			const clientId = randomBytes(24).toString("base64url");
			const row: z.infer<typeof ClientRow> = {
				pk: clientKey(clientId),
				clientId,
				clientName,
				redirectUris: input.redirectUris,
				grants: input.grants,
				tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
				clientIdIssuedAt: nowSec,
				dedupeKey,
				expiresAt: nowSec + IDLE_TTL_SECONDS,
			};
			await clients.put({ Item: row });
			await pointers.put({
				Item: { pk: pointerKey(dedupeKey), clientId, expiresAt: nowSec + IDLE_TTL_SECONDS },
			});
			return toOAuthClient(row);
		},

		async markClientActive(clientId) {
			const row = await getLiveClientRow(clientId);
			if (!row) return;
			const expiresAt = toEpochSeconds(now()) + ACTIVE_TTL_SECONDS;
			// Rewrite the full row (rather than a partial UpdateItem SET) so a swept
			// row is never resurrected as a half-populated, unparseable client.
			await clients.put({ Item: { ...row, expiresAt } });
			await pointers.put({
				Item: { pk: pointerKey(row.dedupeKey), clientId, expiresAt },
			});
		},
	};
}
