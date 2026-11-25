// An optional loopback endpoint reuses a local DynamoDB instance when debugging the worker.
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { getEnv } = require("@packages/require-env");
const storageRequire = createRequire(path.resolve(__dirname, "../../../src/packages/storage-client/package.json"));
const { DynamoDBClient, CreateTableCommand, DeleteTableCommand } = storageRequire("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, TransactWriteCommand } = storageRequire("@aws-sdk/lib-dynamodb");
const { initDynamoBulkSelections, initExportBulkArticles } = require("../dist/runtime/bulk-articles/selection-store");
const { newSelection, articleVersion, targetKey } = require("../dist/runtime/bulk-articles/selection");
const { ReaderArticleHashId, personalReadlistOrder, personalReadlistPartition } = require("@packages/domain/article");
const { initBulkPreparation } = require("../dist/runtime/bulk-articles/dynamo-preparation");
const { initBulkExecution } = require("../dist/runtime/bulk-articles/dynamo-execution");
const { initBulkUploadRetention } = require("../dist/runtime/media-release/bulk-upload-retention");
const { initScheduleHeldUpload } = require("../dist/runtime/media-release/schedule-held-upload");
const { initDynamoDbSavedArticleStore, initDynamoDbPrivateItem } = require("@packages/article-store");
const { Logger, noopLogger } = require("@packages/logger");

async function main(endpoint) {
	assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
	const dynamo = new DynamoDBClient({ endpoint, region: "us-east-1", credentials: { accessKeyId: "local", secretAccessKey: "local" } });
	const client = DynamoDBDocumentClient.from(dynamo);
	const run = randomUUID();
	const tables = [];
	async function create(label, keys, savedIndex = false) {
		const TableName = label + run;
		await dynamo.send(new CreateTableCommand({
			TableName, BillingMode: "PAY_PER_REQUEST",
			AttributeDefinitions: (savedIndex ? [...keys, "savedAt", "personalScope", "personalOrder"] : keys).map(AttributeName => ({ AttributeName, AttributeType: "S" })),
			GlobalSecondaryIndexes: savedIndex ? [{ IndexName: "userId-savedAt-index", KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }, { AttributeName: "savedAt", KeyType: "RANGE" }], Projection: { ProjectionType: "ALL" } },
				{ IndexName: "url-index", KeySchema: [{ AttributeName: "url", KeyType: "HASH" }], Projection: { ProjectionType: "ALL" } },
				{ IndexName: "personalScope-personalOrder-index", KeySchema: [{ AttributeName: "personalScope", KeyType: "HASH" }, { AttributeName: "personalOrder", KeyType: "RANGE" }], Projection: { ProjectionType: "ALL" } }] : undefined,
			KeySchema: keys.map((AttributeName, i) => ({ AttributeName, KeyType: i === 0 ? "HASH" : "RANGE" })),
		}));
		tables.push(TableName);
		return TableName;
	}
	const put = (TableName, Item) => client.send(new PutCommand({ TableName, Item }));
	const get = async (TableName, Key) => (await client.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;

	try {
		const saves = await create("saves", ["userId", "url"], true);
		const users = await create("users", ["email"]);
		const articles = await create("articles", ["url"]);
		let instant = Date.parse("2026-11-24T00:00:00Z");
		const now = () => new Date(instant++);
		const user = { userId: "owner", email: "owner@example.org", emailVerified: true };
		await put(users, user);
		const store = initDynamoBulkSelections(client, saves);
		const current = (job) => store.get(user.userId, job.id);
		let failNotice = true;
		const notices = [];
		const schedules = [];
		const schedulePrivateRelease = initScheduleHeldUpload({ client: { send: async command => schedules.push(command.input) },
			group: "test", roleArn: "scheduler", eventBusArn: "bus", now, publishEvent: async () => assert.fail("expected a future expiry") });
		const execute = initBulkExecution({
			client, userArticlesTable: saves, articlesTable: articles, usersTable: users, findUserById: async () => user,
			schedulePrivateRelease,
			listUserSavesForUrl: async () => [], now, publishEvent: async (definition, detail) => {
				if (failNotice) { failNotice = false; throw new Error("notification unavailable"); }
				notices.push([definition.detailType, detail.url]);
			},
		});
		const seed = async (index) => {
			const key = "example.org/story/" + index;
			const url = "https://" + key;
			const row = { userId: user.userId, url: key, status: "unread", savedAt: now().toISOString() };
			if (typeof index === "number" && index < 18) {
				row.personalScope = personalReadlistPartition(user.userId, "picked", "unread");
				row.personalPickedAt = row.savedAt;
				row.personalOrder = personalReadlistOrder(row.savedAt, ReaderArticleHashId.from(url));
			}
			await put(saves, row);
			await put(articles, { url: key, originalUrl: url });
			return { row, target: { url, key, version: articleVersion(row) } };
		};
		const snapshot = async (action, targets) => {
			const job = newSelection(user.userId, { source: "all", sender: undefined, discovery: undefined, order: "desc", page: 1, status: "unread", extent: "all", action }, now());
			await store.create(job);
			for (let offset = 0; offset < targets.length; offset += 32) {
				const end = offset + 32;
				assert(await store.append(await current(job), targets.slice(offset, end), end < targets.length ? String(end) : undefined, now()));
			}
			const preview = await current(job);
			assert.equal(preview.selected, targets.length);
			assert(await store.confirm(preview, now()));
			assert.equal(await store.confirm(preview, now()), false);
			return job;
		};
		const finish = async job => {
			let steps = 0;
			let header = await current(job);
			while (["running", "restoring"].includes(header.state)) {
				let checked = 0;
				await execute(header, () => ++checked === 1 ? 100_000 : 0);
				const next = await current(job);
				assert(next.generation > header.generation);
				header = next;
				steps++;
			}
			return { header, steps };
		};
		const originals = await Promise.all(Array.from({ length: 36 }, (_, i) => seed(i)));
		const emails = await create("emails", ["userId", "receivedAtMessageId"]);
		const links = await create("links", ["userLinkGroup", "ordinal"]);
		const sender = "newsletter@example.org";
		const issue = now().toISOString() + "#issue";
		await put(emails, { userId: user.userId, receivedAtMessageId: issue, senderEmail: sender, status: "received" });
		const occurrences = [...originals, originals[0]];
		await Promise.all(occurrences.map(({ target }, i) => put(links, { userLinkGroup: user.userId + "#" + issue, ordinal: String(i).padStart(4, "0"), url: target.url })));
		const rows = new Map(originals.map(({ row, target }) => [ReaderArticleHashId.from(target.url).value, { ...row, url: target.url, savedAt: new Date(row.savedAt), personalPickedAt: row.personalPickedAt && new Date(row.personalPickedAt) }]));
		const prepare = initBulkPreparation({ client, saves, emails, links, resolveCanonicalIdentity: async url => url,
			findArticleById: async (id, owner) => owner === user.userId ? rows.get(id.value) : null });
		async function materialize(source, expected = originals.length) {
			const spec = { source, sender: source === "sender" ? sender : undefined, status: "unread", order: "desc", page: 1, extent: "all", action: { kind: "remove" } };
			let job = newSelection(user.userId, spec, now());
			await store.create(job);
			let chunks = 0;
			while (job.state === "preparing") {
				let checked = 0;
				const page = await prepare(job, () => ++checked === 1 ? 100_000 : 0);
				assert(await store.append(job, page.targets, page.next, now()));
				job = await current(job);
				assert(++chunks < 100);
			}
			assert(chunks > 16);
			assert.equal(job.selected, expected);
			return job;
		}
		await materialize("sender");
		await materialize("picked", 18);
		const removal = await materialize("all");
		assert(await store.confirm(removal, now()));
		const running = await current(removal);
		assert(await store.fail(running));
		assert.equal((await current(removal)).failed, originals.length);
		assert(await store.retry(await current(removal)));
		assert.equal((await current(removal)).failed, 0);
		const arrival = await seed("later");
		const [changed, savedAgain, purged] = originals;
		await put(saves, { ...changed.row, status: "read", readAt: now().toISOString(), statusRevision: 1 });
		await put(saves, { ...changed.row, statusRevision: 2 });
		await assert.rejects(execute(await current(removal), () => 100_000), /notification unavailable/);
		const { header: removed, steps } = await finish(removal);
		assert(steps > 16);
		assert.equal(removed.completed, 35);
		assert.equal(removed.skipped, 1);
		assert.equal(removed.restorable, 35);
		assert.equal(notices.length, 35);
		assert(await get(saves, { userId: user.userId, url: arrival.target.key }));
		const exported = await initExportBulkArticles(client, saves)(user.userId, now());
		assert.equal(exported.filter(row => row.recovery).length, 35);
		const later = { ...savedAgain.row, savedAt: now().toISOString() };
		await put(saves, later);
		await put(articles, { url: purged.target.key, lastPurgedAt: now().toISOString() });
		assert(await store.restore(removed, now()));
		const { header: restored } = await finish(removal);
		assert.equal(restored.state, "restored");
		assert.equal(restored.restoredCount, 33);
		assert.equal(restored.restorable, 0);
		assert.equal(restored.skipped, 3);
		assert.equal(notices.length, 68);
		assert.deepEqual(await get(saves, { userId: user.userId, url: savedAgain.target.key }), later);
		assert.equal(await get(saves, { userId: user.userId, url: purged.target.key }), undefined);

		const article = await seed("filing");
		const destination = { kind: "file", destination: "weekend", label: "Weekend", createdAt: now().toISOString() };
		const definition = { userId: user.userId, url: "readplace:queue-def/weekend" };
		await put(saves, { ...definition, queueSlug: "weekend", createdAt: destination.createdAt });
		const missing = await snapshot(destination, [article.target]);
		await client.send(new DeleteCommand({ TableName: saves, Key: definition }));
		assert.equal((await finish(missing)).header.skipped, 1);
		await put(saves, { ...definition, queueSlug: "weekend", createdAt: destination.createdAt });
		const locked = await snapshot(destination, [article.target]);
		await put(users, { ...user, ageLockedAt: now().toISOString() });
		assert.equal((await finish(locked)).header.skipped, 1);
		await put(users, user);
		const file = await snapshot(destination, [article.target]);
		assert.equal((await finish(file)).header.completed, 1);
		const read = await snapshot({ kind: "read" }, [article.target]);
		assert.equal((await finish(read)).header.completed, 1);
		assert.equal((await get(saves, { userId: user.userId, url: article.target.key })).status, "read");
		assert.equal((await get(saves, { userId: user.userId + "#queue/weekend", url: article.target.key })).status, "unread");
		const older = await seed("earlier-expiry");
		const laterRemoval = await seed("later-expiry");
		const mixedExpiry = await snapshot({ kind: "remove" }, [older.target, laterRemoval.target]);
		const mixed = (await finish(mixedExpiry)).header;
		await client.send(new DeleteCommand({ TableName: saves, Key: targetKey(mixed, older.target.key) }));
		assert(await store.restore(mixed, now()));
		const partial = (await finish(mixedExpiry)).header;
		assert.equal(partial.restoredCount, 1);
		assert.equal(partial.skipped, 1);
		assert.equal(partial.restorable, 0);
		const expiring = await snapshot({ kind: "remove" }, [arrival.target]);
		const { header } = await finish(expiring);
		const privateUrl = "https://uploads.readplace.invalid/" + randomUUID().replaceAll("-", "");
		const privateKey = new URL(privateUrl).host + new URL(privateUrl).pathname;
		const privateRow = { userId: user.userId, url: privateKey, savedAt: now().toISOString(), status: "unread" };
		const privateTarget = { url: privateUrl, key: privateKey, version: articleVersion(privateRow) };
		await put(articles, { url: privateKey, originalUrl: privateUrl, ownerUserId: user.userId });
		await put(saves, privateRow);
		const savedStore = initDynamoDbSavedArticleStore({ client, tableName: articles, userArticlesTableName: saves, logger: Logger.from(noopLogger), now });
		const released = [];
		let interruptRelease = false;
		let afterCopyLookup;
		const retention = initBulkUploadRetention({ client, tableName: saves, now, listUserSavesForUrl: async item => {
			const found = await savedStore.listUserSavesForUrl(item);
			if (afterCopyLookup) { const change = afterCopyLookup; afterCopyLookup = undefined; await change(); }
			return found;
		},
			releasePrivateItem: async item => {
				if (interruptRelease) { interruptRelease = false; throw new Error("storage temporarily unavailable"); }
				released.push(item); return "released";
			} });
		const privateItem = { userId: user.userId, url: privateUrl };
		const firstPrivate = await snapshot({ kind: "remove" }, [privateTarget]);
		const held = (await finish(firstPrivate)).header;
		const { marker } = JSON.parse(schedules[0].Target.Input);
		assert.match(marker, /^readplace:removed-article\/[a-f0-9]{64}$/);
		assert.equal(await retention.releaseIfUnheld(privateItem), "retained");
		assert(await store.restore(held, now()));
		assert.equal((await finish(firstPrivate)).header.restoredCount, 1);
		assert.deepEqual(released, []);
		assert.equal(await retention.releaseIfUnheld(privateItem), "retained");
		await retention.releaseExpired(marker);
		const restoredPrivate = await get(saves, { userId: user.userId, url: privateKey });
		const finalPrivate = await snapshot({ kind: "remove" }, [{ ...privateTarget, version: articleVersion(restoredPrivate) }]);
		assert.equal((await finish(finalPrivate)).header.completed, 1);
		assert.notEqual(schedules[0].Name, schedules[1].Name);
		instant += 30 * 86400 * 1000;
		assert.equal(await store.restore(header, now()), false);
		await client.send(new DeleteCommand({ TableName: saves, Key: targetKey(finalPrivate, privateKey) }));
		assert((await savedStore.listUserArticleUrls(user.userId)).includes(privateUrl), "erasure still finds a private upload after recovery TTL");
		// A filing wins between the expiry worker's first read and its transaction.
		const privateCopy = { ...privateRow, userId: user.userId + "#queue/weekend" };
		afterCopyLookup = () => put(saves, privateCopy);
		await retention.releaseExpired(marker);
		assert.deepEqual(released, []);
		assert(await get(saves, { userId: privateCopy.userId, url: privateKey }));
		const backInAll = await savedStore.assignSavedArticleToReadlist({ ...privateItem, from: "weekend", readlist: "default", savedAt: now() });
		assert(backInAll.assigned);
		const finalRow = await get(saves, { userId: user.userId, url: privateKey });
		assert(finalRow);
		let startFiling, finishFiling;
		const filingStarted = new Promise(resolve => { startFiling = resolve; });
		const resumeFiling = new Promise(resolve => { finishFiling = resolve; });
		const slowClient = { send: async command => {
			if (command instanceof TransactWriteCommand) { startFiling(); await resumeFiling; }
			return client.send(command);
		} };
		const slowStore = initDynamoDbSavedArticleStore({ client: slowClient, tableName: articles, userArticlesTableName: saves, logger: Logger.from(noopLogger), now });
		const lateFiling = slowStore.assignSavedArticleToReadlist({ ...privateItem, from: "default", readlist: "late", savedAt: now() });
		await filingStarted;
		const last = await snapshot({ kind: "remove" }, [{ ...privateTarget, version: articleVersion(finalRow) }]);
		await finish(last);
		await client.send(new DeleteCommand({ TableName: saves, Key: { userId: privateCopy.userId, url: privateKey } }));
		instant += 30 * 86400 * 1000;
		interruptRelease = true;
		await assert.rejects(retention.releaseExpired(marker), /storage temporarily unavailable/);
		finishFiling();
		assert.deepEqual(await lateFiling, { assigned: false });
		assert.equal(await get(saves, { userId: user.userId + "#queue/late", url: privateKey }), undefined);
		await assert.rejects(savedStore.saveArticle({ ...privateItem, metadata: { title: "Private book", siteName: "", excerpt: "", wordCount: 1 },
			estimatedReadTime: 1, provenance: { kind: "web" }, saveTrigger: "manual", requestedAt: now(), savedAt: now() }), { name: "ArticlePurgedAfterRequest" });
		// After an interrupted purge, even a delayed upload commit cannot recreate its original row.
		await client.send(new DeleteCommand({ TableName: articles, Key: { url: privateKey } }));
		const privateStore = initDynamoDbPrivateItem({ client, tableName: articles, userArticlesTableName: saves });
		await assert.rejects(privateStore.savePrivateItem({ url: privateUrl, ownerUserId: user.userId, media: { kind: "book", fileName: "book.epub" }, savedAt: now() }));
		assert.equal(await get(saves, { userId: user.userId, url: privateKey }), undefined);
		assert((await savedStore.listUserArticleUrls(user.userId)).includes(privateUrl));
		await retention.releaseExpired(marker);
		await retention.releaseExpired(marker);
		assert.deepEqual(released, [privateItem]);
		await savedStore.deleteAllUserArticles(user.userId);
		assert.equal(await get(saves, { userId: user.userId, url: marker }), undefined);
		await retention.releaseExpired(marker);
		assert.deepEqual(released, [privateItem], "an expired schedule cannot rediscover an erased owner");
		console.log("Bulk recovery passed with " + steps + " execution checkpoints.");
	} finally {
		await Promise.all(tables.map(TableName => dynamo.send(new DeleteTableCommand({ TableName }))));
		dynamo.destroy();
	}
}

async function runWithJava(directory) {
	const libraries = path.join(directory, "DynamoDBLocal_lib");
	const classpath = [directory, path.join(directory, "DynamoDBLocal.jar"), path.join(libraries, "*")].join(path.delimiter);
	const server = spawn("java", ["-Djava.library.path=" + libraries, "-cp", classpath, "LoopbackDynamoDB"], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	const exited = new Promise(resolve => server.once("close", (code, signal) => resolve(signal || code)));
	let spawnError;
	server.once("error", error => { spawnError = error; });
	const startupTimeout = setTimeout(() => server.kill(), 180_000);
	let ready = false;
	let status;
	try {
		for await (const line of createInterface({ input: server.stdout })) {
			if (/^http:\/\/127\.0\.0\.1:\d+$/.test(line)) {
				ready = true;
				clearTimeout(startupTimeout);
				await main(line);
				break;
			}
			console.log(line);
		}
	} finally {
		clearTimeout(startupTimeout);
		server.stdin.end();
		status = await exited;
	}
	if (!ready || status !== 0) throw spawnError || new Error("DynamoDB Local exited unexpectedly (" + status + ")");
}

async function run() {
	if (process.argv[2]) return main(process.argv[2]);
	const dynamoDbLocalHome = getEnv("DYNAMODB_LOCAL_HOME");
	if (dynamoDbLocalHome) return runWithJava(dynamoDbLocalHome);
	const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
	const container = docker("run", "--detach", "--rm", "--publish", "127.0.0.1::8000",
		"amazon/dynamodb-local:2.5.4@sha256:cf8cebd061f988628c02daff10fdb950a54478feff9c52f6ddf84710fe3c3906",
		"-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb", "-disableTelemetry");
	const stop = () => docker("rm", "--force", container);
	const interrupted = () => { stop(); process.exit(130); };
	process.once("SIGINT", interrupted);
	process.once("SIGTERM", interrupted);
	try {
		const endpoint = "http://" + docker("port", container, "8000/tcp");
		assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
		const readyBy = Date.now() + 180_000;
		while (Date.now() < readyBy) {
			try {
				const response = await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
				await response.body?.cancel();
			} catch (error) {
				if (error.name !== "TimeoutError" && !(error instanceof TypeError && error.cause?.code)) throw error;
				await delay(500);
				continue;
			}
			return await main(endpoint);
		}
		throw new Error("DynamoDB Local did not become ready");
	} finally {
		process.off("SIGINT", interrupted);
		process.off("SIGTERM", interrupted);
		stop();
	}
}

run().catch(error => { console.error(error); process.exitCode = 1; });
