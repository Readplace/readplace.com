import { z } from "zod";

export type JsonRpcId = string | number | null;

interface JsonRpcSuccess {
	readonly jsonrpc: "2.0";
	readonly id: JsonRpcId;
	readonly result: unknown;
}

interface JsonRpcFailure {
	readonly jsonrpc: "2.0";
	readonly id: JsonRpcId;
	readonly error: { readonly code: number; readonly message: string };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export const EnvelopeSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.union([z.string(), z.number(), z.null()]).optional(),
	method: z.string(),
	params: z.unknown().optional(),
});

export const InitializeParams = z
	.object({
		protocolVersion: z.unknown(),
		clientInfo: z
			.object({
				name: z.string().optional().catch(undefined),
				version: z.string().optional().catch(undefined),
			})
			.catch({}),
	})
	.catch({ protocolVersion: undefined, clientInfo: {} });

export const ToolCallParams = z.object({
	name: z.string(),
	arguments: z.unknown().optional(),
});

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Best-effort id for an error reply to a malformed message: echo a string or
 * number id if one is present, else null (JSON-RPC's "unknown id"). */
export function extractId(raw: unknown): JsonRpcId {
	if (isRecord(raw)) {
		const id = raw.id;
		if (typeof id === "string" || typeof id === "number") return id;
	}
	return null;
}

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
	return { jsonrpc: "2.0", id, result };
}

export function failure(id: JsonRpcId, code: number, message: string): JsonRpcFailure {
	return { jsonrpc: "2.0", id, error: { code, message } };
}
