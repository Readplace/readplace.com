import { NoSuchKey, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import type { NewsletterCatalogDocument } from "@packages/domain/newsletter-catalog";
import type { HutchLogger } from "@packages/hutch-logger";
import { initS3NewsletterCatalog } from "./s3-newsletter-catalog";

type SendFn = S3Client["send"];

interface SentCommand {
	name: string;
	input: {
		Bucket?: string;
		Key?: string;
		Body?: string;
		ContentType?: string;
		IfMatch?: string;
		IfNoneMatch?: string;
	};
}

const CATALOG: NewsletterCatalogDocument = {
	version: 1,
	records: [
		{
			from: ForwardableSenderSchema.parse("pragmaticengineer@substack.com"),
			name: undefined,
			status: "pending",
			evidence: [{ kind: "seed", note: "Supplied user feedback", addedAt: "2026-09-30T00:00:00.000Z" }],
			createdAt: "2026-09-30T00:00:00.000Z",
			updatedAt: "2026-09-30T00:00:00.000Z",
		},
	],
};

function s3Error(status: number, name: string): S3ServiceException {
	return new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode: status }, message: name });
}

function stored(document: unknown, etag = '"etag-1"') {
	return { Body: { transformToString: async () => JSON.stringify(document) }, ETag: etag };
}

function harness(reply: (command: SentCommand) => unknown) {
	const commands: SentCommand[] = [];
	const errors: unknown[][] = [];
	const logger: HutchLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: (...args) => { errors.push(args); } };
	const send = async (command: { constructor: { name: string }; input: SentCommand["input"] }) => {
		const sent = { name: command.constructor.name, input: command.input };
		commands.push(sent);
		return reply(sent);
	};
	const catalog = initS3NewsletterCatalog({
		client: { send: send as unknown as SendFn },
		bucketName: "catalog-bucket",
		key: "newsletter-catalog.json",
		logger,
	});
	return { ...catalog, commands, errors };
}

describe("initS3NewsletterCatalog", () => {
	describe("readCatalog", () => {
		it("reads and parses the catalog document with its ETag", async () => {
			const { readCatalog, commands } = harness(() => stored(CATALOG));

			expect(await readCatalog()).toEqual({ ok: true, document: CATALOG, etag: '"etag-1"' });
			expect(commands[0]).toEqual({ name: "GetObjectCommand", input: { Bucket: "catalog-bucket", Key: "newsletter-catalog.json" } });
		});

		it("revalidates the cached document by ETag and reuses it when S3 answers Not Modified", async () => {
			let reads = 0;
			const { readCatalog, commands } = harness(() => {
				reads += 1;
				if (reads === 1) return stored(CATALOG);
				throw s3Error(304, "NotModified");
			});
			await readCatalog();

			expect(await readCatalog()).toEqual({ ok: true, document: CATALOG, etag: '"etag-1"' });
			expect(commands[1].input.IfNoneMatch).toBe('"etag-1"');
		});

		it("replaces the cache when the object changed since the last read", async () => {
			const changed = { version: 1, records: [] };
			let reads = 0;
			const { readCatalog } = harness(() => {
				reads += 1;
				return reads === 1 ? stored(CATALOG) : stored(changed, '"etag-2"');
			});
			await readCatalog();

			expect(await readCatalog()).toEqual({ ok: true, document: changed, etag: '"etag-2"' });
		});

		it("starts from an empty catalog with no ETag when the object does not exist yet", async () => {
			const { readCatalog } = harness(() => {
				throw new NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: "missing" });
			});

			expect(await readCatalog()).toEqual({ ok: true, document: { version: 1, records: [] }, etag: undefined });
		});

		it("reports the catalog unavailable, and logs why, when S3 fails or the document is unreadable", async () => {
			for (const reply of [
				() => { throw s3Error(503, "ServiceUnavailable"); },
				() => { throw s3Error(304, "NotModified"); },
				() => { throw new Error("socket hang up"); },
				() => stored({ version: 2, records: [] }),
				() => ({ Body: { transformToString: async () => "not json" }, ETag: '"etag-1"' }),
				() => ({ ETag: '"etag-1"' }),
				() => ({ Body: { transformToString: async () => JSON.stringify(CATALOG) } }),
			]) {
				const { readCatalog, errors } = harness(reply);
				expect(await readCatalog()).toEqual({ ok: false, reason: "unavailable" });
				expect(errors[0][0]).toBe("[newsletter-catalog] could not read the catalog");
			}
		});

		it("reports the catalog unavailable when revalidation fails for a reason other than Not Modified", async () => {
			let reads = 0;
			const { readCatalog } = harness(() => {
				reads += 1;
				if (reads === 1) return stored(CATALOG);
				throw s3Error(500, "InternalError");
			});
			await readCatalog();

			expect(await readCatalog()).toEqual({ ok: false, reason: "unavailable" });
		});
	});

	describe("writeCatalog", () => {
		it("creates the catalog only when no object exists yet", async () => {
			const { writeCatalog, commands } = harness(() => ({ ETag: '"etag-1"' }));

			expect(await writeCatalog({ document: CATALOG, expectedEtag: undefined })).toEqual({ ok: true, etag: '"etag-1"' });
			expect(commands[0]).toEqual({
				name: "PutObjectCommand",
				input: {
					Bucket: "catalog-bucket",
					Key: "newsletter-catalog.json",
					Body: JSON.stringify(CATALOG),
					ContentType: "application/json",
					IfNoneMatch: "*",
				},
			});
		});

		it("replaces the catalog only while it still carries the ETag the change was based on, then serves reads from the written copy", async () => {
			const { writeCatalog, readCatalog, commands } = harness((command) => {
				if (command.name === "PutObjectCommand") return { ETag: '"etag-2"' };
				throw s3Error(304, "NotModified");
			});

			expect(await writeCatalog({ document: CATALOG, expectedEtag: '"etag-1"' })).toEqual({ ok: true, etag: '"etag-2"' });
			expect(commands[0].input.IfMatch).toBe('"etag-1"');
			expect(await readCatalog()).toEqual({ ok: true, document: CATALOG, etag: '"etag-2"' });
			expect(commands[1].input.IfNoneMatch).toBe('"etag-2"');
		});

		it("reports a conflict when another writer changed or created the catalog first", async () => {
			for (const failure of [s3Error(412, "PreconditionFailed"), s3Error(409, "ConditionalRequestConflict")]) {
				const { writeCatalog, errors } = harness(() => { throw failure; });
				expect(await writeCatalog({ document: CATALOG, expectedEtag: '"etag-1"' })).toEqual({ ok: false, reason: "conflict" });
				expect(errors).toEqual([]);
			}
		});

		it("reports the catalog unavailable, and logs why, when the write fails otherwise", async () => {
			for (const reply of [
				() => { throw s3Error(503, "SlowDown"); },
				() => { throw new Error("socket hang up"); },
				() => ({}),
			]) {
				const { writeCatalog, errors } = harness(reply);
				expect(await writeCatalog({ document: CATALOG, expectedEtag: undefined })).toEqual({ ok: false, reason: "unavailable" });
				expect(errors[0][0]).toBe("[newsletter-catalog] could not write the catalog");
			}
		});
	});
});
