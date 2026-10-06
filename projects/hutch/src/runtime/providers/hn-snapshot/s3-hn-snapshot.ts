import assert from "node:assert";
import { GetObjectCommand, PutObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { HnSnapshotSchema, type HnSnapshotStore } from "../../domain/engagement/hn-snapshot";

export function initS3HnSnapshot(deps: {
	bucketName: string;
	get: (
		command: GetObjectCommand,
	) => Promise<{ Body?: { transformToString: (encoding: string) => Promise<string> } }>;
	put: (command: PutObjectCommand) => Promise<unknown>;
}): HnSnapshotStore {
	const key = (day: string) => `engagement-starter/hn-snapshots/${day}.json`;
	const find: HnSnapshotStore["find"] = async (day) => {
		try {
			const response = await deps.get(
				new GetObjectCommand({ Bucket: deps.bucketName, Key: key(day) }),
			);
			assert(response.Body, "HN manifest has a body");
			return HnSnapshotSchema.parse(JSON.parse(await response.Body.transformToString("utf-8")));
		} catch (error) {
			if (error instanceof NoSuchKey) return undefined;
			throw error;
		}
	};
	return {
		find,
		create: async ({ day, snapshot }) => {
			try {
				await deps.put(
					new PutObjectCommand({
						Bucket: deps.bucketName,
						Key: key(day),
						ContentType: "application/json",
						Body: JSON.stringify(snapshot),
						IfNoneMatch: "*",
					}),
				);
				return snapshot;
			} catch (error) {
				if (!(error instanceof Error) || error.name !== "PreconditionFailed") throw error;
				const existing = await find(day);
				assert(existing, "a competing manifest creator wrote a snapshot");
				return existing;
			}
		},
		update: async ({ day, snapshot }) => {
			await deps.put(
				new PutObjectCommand({
					Bucket: deps.bucketName,
					Key: key(day),
					ContentType: "application/json",
					Body: JSON.stringify(snapshot),
				}),
			);
		},
	};
}
