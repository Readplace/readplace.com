import assert from "node:assert";
import type {
	BatchGetCommandInput,
	DeleteCommandInput,
	DynamoDBDocumentClient,
	PutCommandInput,
	QueryCommandInput,
	ScanCommandInput,
	UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
	BatchGetCommand,
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { z } from "zod";

type Key = Record<string, string | number>;

/** Every command input minus `TableName` — the gateway supplies the name. */
type WithoutTable<T> = Omit<T, "TableName">;

export type DynamoTable<TSchema extends z.ZodObject> = {
	/**
	 * Fetch a single item by its primary key. Returns `undefined` if the item
	 * does not exist. The item is parsed through the row schema so every
	 * optional field is typed as `T | undefined` (never `null`).
	 */
	get: (
		key: Key,
		options?: {
			projection?: readonly (keyof z.infer<TSchema>)[];
			consistentRead?: boolean;
		},
	) => Promise<z.infer<TSchema> | undefined>;

	/** Raw Put passthrough. Item is not parsed — writes bypass the read-side schema. */
	put: (input: WithoutTable<PutCommandInput>) => Promise<void>;

	/** Raw Update passthrough. */
	update: (input: WithoutTable<UpdateCommandInput>) => Promise<void>;

	/**
	 * Raw Delete passthrough. Returns `{ Attributes }` when the caller sets
	 * `ReturnValues: "ALL_OLD"`, parsed through the row schema; otherwise
	 * resolves with an empty object.
	 */
	delete: (
		input: WithoutTable<DeleteCommandInput>,
	) => Promise<{ Attributes?: z.infer<TSchema> }>;

	/**
	 * Query passthrough. Returns items parsed through the row schema, the
	 * SDK-reported `Count` (useful with `Select: "COUNT"`), and the
	 * `LastEvaluatedKey` for pagination.
	 */
	query: (input: WithoutTable<QueryCommandInput>) => Promise<{
		items: z.infer<TSchema>[];
		count: number;
		lastEvaluatedKey?: Record<string, unknown>;
	}>;

	/**
	 * Scan passthrough. Returns parsed items, the SDK-reported count, and
	 * `LastEvaluatedKey` so callers can drive pagination (pass it back as
	 * `ExclusiveStartKey`). When `Select: "COUNT"` is used, `items` will be
	 * empty and `count` holds the matching row count.
	 */
	scan: (
		input?: WithoutTable<ScanCommandInput>,
	) => Promise<{
		items: z.infer<TSchema>[];
		count: number;
		lastEvaluatedKey?: Record<string, unknown>;
	}>;
};

/**
 * Create a typed gateway for a single DynamoDB table. All item reads are
 * funnelled through the provided Zod schema — the schema is the single
 * source of truth for which attributes are required vs. optional.
 *
 * For optional attributes, use `dynamoField(z.string())` instead of
 * `z.string().optional()` so that `null` values stored by DynamoDB are
 * accepted and normalized.
 */
export function defineDynamoTable<TSchema extends z.ZodObject>(config: {
	client: DynamoDBDocumentClient;
	tableName: string;
	schema: TSchema;
}): DynamoTable<TSchema> {
	const { client, tableName, schema } = config;

	return {
		async get(key, options) {
			const fields = options?.projection;
			// Alias every projected attribute with `#` so reserved keywords (e.g.
			// `url`, `name`, `status`) don't trip the ProjectionExpression parser.
			const projectionOptions = fields
				? {
						ProjectionExpression: fields.map((f) => `#${String(f)}`).join(", "),
						ExpressionAttributeNames: Object.fromEntries(
							fields.map((f) => [`#${String(f)}`, String(f)]),
						),
					}
				: {};
			const consistentOptions = options?.consistentRead ? { ConsistentRead: true } : {};
			const result = await client.send(
				new GetCommand({
					TableName: tableName,
					Key: key,
					...projectionOptions,
					...consistentOptions,
				}),
			);
			if (!result.Item) return undefined;
			return schema.parse(result.Item);
		},
		async put(input) {
			await client.send(new PutCommand({ TableName: tableName, ...input }));
		},
		async update(input) {
			await client.send(new UpdateCommand({ TableName: tableName, ...input }));
		},
		async delete(input) {
			const result = await client.send(new DeleteCommand({ TableName: tableName, ...input }));
			if (!result.Attributes) return {};
			return { Attributes: schema.parse(result.Attributes) };
		},
		async query(input) {
			const result = await client.send(
				new QueryCommand({ TableName: tableName, ...input }),
			);
			const items = (result.Items ?? []).map((item) => schema.parse(item));
			return {
				items,
				count: result.Count ?? 0,
				lastEvaluatedKey: result.LastEvaluatedKey,
			};
		},
		async scan(input) {
			const result = await client.send(
				new ScanCommand({ TableName: tableName, ...(input ?? {}) }),
			);
			const items = (result.Items ?? []).map((item) => schema.parse(item));
			return {
				items,
				count: result.Count ?? 0,
				lastEvaluatedKey: result.LastEvaluatedKey,
			};
		},
	};
}

// DynamoDB BatchGetItem accepts at most 100 keys per request.
const BATCH_GET_MAX_KEYS = 100;
const UNPROCESSED_KEYS_MAX_RETRIES = 5;
const UNPROCESSED_KEYS_INITIAL_DELAY_MS = 50;

/**
 * BatchGet across a single table. Items are parsed through the row schema.
 * Exposed as a top-level helper because BatchGetCommand is multi-table at the
 * SDK level but most callers only need single-table fan-out.
 *
 * Chunks `keys` into requests of 100 (the DynamoDB BatchGetItem limit) issued
 * in parallel, and retries any `UnprocessedKeys` returned by DynamoDB (caused
 * by the 16 MB response cap or throttling) with exponential backoff.
 */
export async function batchGetFromTable<TSchema extends z.ZodObject>(config: {
	client: DynamoDBDocumentClient;
	tableName: string;
	schema: TSchema;
	keys: readonly Key[];
	projection?: readonly (keyof z.infer<TSchema>)[];
}): Promise<z.infer<TSchema>[]> {
	const { client, tableName, schema, keys, projection } = config;
	if (keys.length === 0) return [];

	const chunks: Key[][] = [];
	for (let i = 0; i < keys.length; i += BATCH_GET_MAX_KEYS) {
		chunks.push(keys.slice(i, i + BATCH_GET_MAX_KEYS));
	}

	// Alias every projected attribute with `#` so reserved keywords (e.g.
	// `url`, `name`, `status`) don't trip the ProjectionExpression parser.
	const projectionOptions = projection
		? {
				ProjectionExpression: projection.map((f) => `#${String(f)}`).join(", "),
				ExpressionAttributeNames: Object.fromEntries(
					projection.map((f) => [`#${String(f)}`, String(f)]),
				),
			}
		: {};

	const buildRequest = (batchKeys: readonly Key[]): BatchGetCommandInput => ({
		RequestItems: {
			[tableName]: {
				Keys: batchKeys as Key[],
				...projectionOptions,
			},
		},
	});

	const batches = await Promise.all(
		chunks.map(async (chunk) => {
			const collected: Record<string, unknown>[] = [];
			let pending: readonly Key[] = chunk;
			for (let attempt = 0; ; attempt++) {
				const result = await client.send(new BatchGetCommand(buildRequest(pending)));
				const items = result.Responses?.[tableName] ?? [];
				collected.push(...items);
				const unprocessed = result.UnprocessedKeys?.[tableName]?.Keys ?? [];
				if (unprocessed.length === 0) return collected;
				assert(
					attempt < UNPROCESSED_KEYS_MAX_RETRIES,
					`BatchGet on ${tableName} returned UnprocessedKeys after ${UNPROCESSED_KEYS_MAX_RETRIES} retries`,
				);
				await new Promise((resolve) =>
					setTimeout(resolve, UNPROCESSED_KEYS_INITIAL_DELAY_MS * 2 ** attempt),
				);
				pending = unprocessed as Key[];
			}
		}),
	);

	return batches.flat().map((item) => schema.parse(item));
}

/** Re-exported so composition roots can type the client without importing the SDK. */
export type { DynamoDBDocumentClient };

/**
 * Assertion helper for callers that expect a row to exist. Use when absence
 * is a bug (not a not-found). Narrows `T | undefined` to `T`.
 */
export function assertItem<T>(item: T | undefined, message: string): asserts item is T {
	assert(item !== undefined, message);
}
