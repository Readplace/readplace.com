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
const { TransactionCanceledException } = storageRequire("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand, TransactWriteCommand, BatchGetCommand } = storageRequire("@aws-sdk/lib-dynamodb");
const { initDynamoBulkSelections, initExportBulkArticles } = require("../dist/runtime/bulk-articles/selection-store");
const { newSelection, articleVersion, targetKey } = require("../dist/runtime/bulk-articles/selection");
const { ReaderArticleHashId, personalReadlistOrder, personalReadlistPartition } = require("@packages/domain/article");
const { initBulkPreparation } = require("../dist/runtime/bulk-articles/dynamo-preparation");
const { initBulkExecution } = require("../dist/runtime/bulk-articles/dynamo-execution");
const { initBulkUploadRetention } = require("../dist/runtime/media-release/bulk-upload-retention");
const { initScheduleHeldUpload } = require("../dist/runtime/media-release/schedule-held-upload");
const { initDynamoDbSavedArticleStore, initDynamoDbPrivateItem, initDynamoDbReadlistDefinitions, canonicalRemovalKey, UNKNOWN_ORIGIN_FILTER } = require("@packages/article-store");
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
		await readEverywhereScenarios({ client, saves, users, articles, store, put, get, setInstant: at => { instant = at; }, now });
		console.log("Bulk recovery passed with " + steps + " execution checkpoints.");
	} finally {
		await Promise.all(tables.map(TableName => dynamo.send(new DeleteTableCommand({ TableName }))));
		dynamo.destroy();
	}
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const RETENTION_SECONDS = 30 * 86400;

async function readEverywhereScenarios({ client, saves, users, articles, store, put, get, setInstant, now }) {
	const defs = initDynamoDbReadlistDefinitions({ client, userArticlesTableName: saves });
	const savedStore = initDynamoDbSavedArticleStore({ client, tableName: articles, userArticlesTableName: saves, logger: Logger.from(noopLogger), now });
	const owners = new Map();
	const sideEffects = [];
	const transactionSizes = [];
	let cancellations = 0;
	let rejectKey;
	let duringEnumeration;
	let afterHoldings;
	const injected = () => new TransactionCanceledException({ message: "injected", $metadata: {}, CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
	const watched = { send: async command => {
		if (command instanceof TransactWriteCommand) {
			const items = command.input.TransactItems;
			transactionSizes.push(items.length);
			if (rejectKey && items.some(item => item.Update?.Key?.url === rejectKey)) { cancellations++; throw injected(); }
			try { return await client.send(command); } catch (error) {
				if (error instanceof TransactionCanceledException) cancellations++;
				throw error;
			}
		}
		const result = await client.send(command);
		if (command instanceof BatchGetCommand && afterHoldings) { const change = afterHoldings; afterHoldings = undefined; await change(); }
		return result;
	} };
	const execute = initBulkExecution({
		client: watched, userArticlesTable: saves, articlesTable: articles, usersTable: users, now,
		findUserById: async userId => (await get(users, { email: owners.get(userId).email })),
		listUserSavesForUrl: async () => assert.fail("a bulk read does not look up other saves"),
		publishEvent: async (definition, detail) => { sideEffects.push([definition.detailType, detail]); },
		schedulePrivateRelease: async (...args) => { sideEffects.push(["private-release", args]); },
		listReadlistDefinitions: async userId => {
			const lists = await defs.listReadlistDefinitions(userId);
			if (duringEnumeration) { const change = duringEnumeration; duringEnumeration = undefined; await change(); }
			return lists;
		},
	});
	const owner = async name => {
		const user = { userId: name, email: name + "@example.org", emailVerified: true };
		await put(users, user);
		owners.set(name, user);
		return user.userId;
	};
	const normalized = row => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, value === null ? undefined : value]));
	const article = async (userId, name, fields = {}, host = "example.org/everywhere/") => {
		const key = host + name;
		const url = "https://" + key;
		const row = { userId, url: key, status: "unread", savedAt: now().toISOString(), ...fields };
		await put(saves, row);
		await put(articles, { url: key, originalUrl: url });
		return { key, url, row, target: { url, key, version: articleVersion(normalized(row)) } };
	};
	const holding = (userId, slug, key, fields = {}) => put(saves, { userId: userId + "#queue/" + slug, url: key, status: "unread", savedAt: now().toISOString(), ...fields });
	const list = async (userId, slug) => assert((await defs.createReadlistDefinition({ userId, slug, label: slug, createdAt: now() })).created);
	const row = (userId, key, slug) => get(saves, { userId: slug ? userId + "#queue/" + slug : userId, url: key });
	const revisionOf = async userId => (await get(saves, { userId, url: "readplace:queue-revision" }))?.definitionRevision;
	const header = job => store.get(job.userId, job.id);
	const spec = (extra = {}) => ({ source: "all", sender: undefined, discovery: undefined, order: "desc", page: 1, status: "unread", extent: "all", action: { kind: "read-everywhere" }, ...extra });
	const confirmed = async (userId, targets, extra) => {
		const job = newSelection(userId, spec(extra), now());
		await store.create(job);
		assert(await store.append(job, targets, undefined, now()));
		assert(await store.confirm(await header(job), now()));
		return job;
	};
	const finish = async job => {
		let current = await header(job);
		for (let steps = 0; current.state === "running"; steps++) {
			assert(steps < 20);
			await execute(current, () => 100_000);
			const next = await header(job);
			assert(next.generation > current.generation);
			current = next;
		}
		return current;
	};

	// Omitted and NULL revisions in both positions, an already-read sibling, legacy NULL metadata and Hand Picked ordering.
	const reader = await owner("everywhere-reader");
	await list(reader, "weekend");
	await list(reader, "work");
	const earlierRead = "2026-11-01T00:00:00.000Z";
	const one = await article(reader, "one", { viewedAt: null, personalDecision: null, provenance: { kind: "web" }, suggestionAttribution: { campaignId: "c", rank: 2 } });
	await holding(reader, "weekend", one.key, { statusRevision: null });
	await holding(reader, "work", one.key, { status: "read", readAt: earlierRead, statusRevision: 3 });
	const pickedAt = now().toISOString();
	const two = await article(reader, "two", { statusRevision: null, personalPickedAt: pickedAt,
		personalScope: personalReadlistPartition(reader, "picked", "unread"), personalOrder: personalReadlistOrder(pickedAt, ReaderArticleHashId.from("https://example.org/everywhere/two")) });
	await holding(reader, "work", two.key);
	const upload = await article(reader, randomUUID().replaceAll("-", ""), {}, "uploads.readplace.invalid/");
	const unrelated = await article(reader, "unrelated");
	await holding(reader, "weekend", unrelated.key);
	const stranger = await owner("everywhere-stranger");
	await put(saves, { ...one.row, userId: stranger });
	const firstJob = await confirmed(reader, [one.target, two.target, upload.target]);
	const running = await header(firstJob);
	const done = await finish(firstJob);
	assert.equal(done.state, "completed");
	assert.deepEqual([done.selected, done.completed, done.skipped], [3, 3, 0]);
	const oneDefault = await row(reader, one.key);
	const readAt = oneDefault.readAt;
	assert.deepEqual([oneDefault.status, oneDefault.statusRevision, oneDefault.savedAt, oneDefault.viewedAt, oneDefault.personalDecision], ["read", 1, one.row.savedAt, null, null]);
	assert.deepEqual(oneDefault.provenance, { kind: "web" });
	assert.deepEqual(oneDefault.suggestionAttribution, { campaignId: "c", rank: 2 });
	assert.equal(oneDefault.personalScope, undefined);
	const weekendCopy = await row(reader, one.key, "weekend");
	assert.deepEqual([weekendCopy.status, weekendCopy.readAt, weekendCopy.statusRevision], ["read", readAt, 1]);
	const sibling = await row(reader, one.key, "work");
	assert.deepEqual([sibling.status, sibling.readAt, sibling.statusRevision, sibling.personalScope], ["read", earlierRead, 3, undefined]);
	const twoDefault = await row(reader, two.key);
	assert.deepEqual([twoDefault.status, twoDefault.statusRevision], ["read", 1]);
	assert.equal(twoDefault.personalScope, personalReadlistPartition(reader, "picked", "read"));
	assert.equal(twoDefault.personalOrder, personalReadlistOrder(twoDefault.readAt, ReaderArticleHashId.from(two.url)));
	assert.equal((await row(reader, two.key, "work")).readAt, twoDefault.readAt);
	assert.equal((await row(reader, upload.key)).status, "read");
	assert.equal((await row(reader, unrelated.key)).status, "unread");
	assert.equal((await row(reader, unrelated.key, "weekend")).status, "unread");
	assert.equal((await row(stranger, one.key)).status, "unread");
	assert.equal(await get(saves, canonicalRemovalKey(reader, one.key)), undefined);

	// A later filing stays unread, and a replayed command cannot reverse a later explicit mark-unread.
	await list(reader, "later");
	await holding(reader, "later", one.key);
	await put(saves, { ...(await row(reader, one.key)), status: "unread", readAt: undefined, statusRevision: 2 });
	await execute(running, () => 100_000);
	assert.equal((await row(reader, one.key)).status, "unread");
	assert.equal((await row(reader, one.key, "later")).status, "unread");
	assert.equal((await header(firstJob)).completed, 3);

	// The production export reader still returns a logically expired job whose outer header is live.
	const exported = await initExportBulkArticles(client, saves)(reader, new Date((done.expiresAt + 86400) * 1000));
	assert(exported.some(record => record.selection?.spec.action.kind === "read-everywhere"), "export keeps a logically expired new-action header");

	// A reader with no named readlists.
	const solo = await owner("everywhere-solo");
	const lone = await article(solo, "lone");
	assert.equal((await finish(await confirmed(solo, [lone.target]))).completed, 1);
	assert.deepEqual([(await row(solo, lone.key)).status, await revisionOf(solo)], ["read", undefined]);

	// A readlist created and filed into while the worker enumerates cancels the first commit; the retry marks all three.
	const racer = await owner("everywhere-racer");
	await list(racer, "work");
	const raced = await article(racer, "raced");
	const racedJob = await confirmed(racer, [raced.target]);
	let before = cancellations;
	duringEnumeration = async () => {
		await list(racer, "weekend");
		await holding(racer, "weekend", raced.key);
		await holding(racer, "work", raced.key);
	};
	assert.equal((await finish(racedJob)).completed, 1);
	assert.equal(cancellations, before + 1);
	for (const slug of [undefined, "weekend", "work"]) assert.equal((await row(racer, raced.key, slug)).status, "read");

	// A filing into an existing, absent partition after the holdings were read.
	const filer = await owner("everywhere-filer");
	await list(filer, "work");
	const filed = await article(filer, "filed");
	const filedJob = await confirmed(filer, [filed.target]);
	before = cancellations;
	afterHoldings = () => holding(filer, "work", filed.key);
	assert.equal((await finish(filedJob)).completed, 1);
	assert.equal(cancellations, before + 1);
	assert.equal((await row(filer, filed.key, "work")).status, "read");

	// Deleting and recreating a readlist under the same slug during enumeration.
	const recreator = await owner("everywhere-recreator");
	await list(recreator, "work");
	const reused = await article(recreator, "reused");
	const reusedJob = await confirmed(recreator, [reused.target]);
	duringEnumeration = async () => {
		assert((await defs.deleteReadlistDefinition({ userId: recreator, slug: "work" })).deleted);
		await list(recreator, "work");
		await holding(recreator, "work", reused.key);
	};
	assert.equal((await finish(reusedJob)).completed, 1);
	assert.equal(await revisionOf(recreator), 3);
	assert.equal((await row(recreator, reused.key, "work")).status, "read");

	// Contention that makes the source ineligible skips it once and leaves its named holdings unread.
	const ineligible = async (name, change, cancelled = 1) => {
		const userId = await owner("everywhere-" + name);
		await list(userId, "weekend");
		const item = await article(userId, name);
		await holding(userId, "weekend", item.key);
		const job = await confirmed(userId, [item.target]);
		const earlier = cancellations;
		afterHoldings = () => change(userId, item);
		const result = await finish(job);
		assert.deepEqual([result.state, result.completed, result.skipped], ["completed", 0, 1], name);
		assert.equal(cancellations, earlier + cancelled, name);
		assert.equal((await row(userId, item.key, "weekend")).status, "unread", name);
		return { userId, item };
	};
	const changedVersion = await ineligible("version", async (userId, item) => put(saves, { ...(await row(userId, item.key)), statusRevision: 2 }));
	assert.equal((await row(changedVersion.userId, changedVersion.item.key)).status, "unread");
	await ineligible("retired", async userId => put(users, { ...owners.get(userId), deletedAt: now().toISOString() }));
	const purged = await ineligible("purged", async (_userId, item) => put(articles, { url: item.key, originalUrl: item.url, purgedAt: now().toISOString() }), 0);
	assert.equal((await row(purged.userId, purged.item.key)).status, "unread");

	// Definition revision contract on the real table.
	const creator = await owner("definitions-creator");
	assert.equal(await revisionOf(creator), undefined);
	assert.deepEqual(await defs.createReadlistDefinition({ userId: creator, slug: "first", label: "First", createdAt: now() }), { created: true, ownedCount: 1 });
	assert.equal(await revisionOf(creator), 1);
	assert.deepEqual(await defs.createReadlistDefinition({ userId: creator, slug: "first", label: "Again", createdAt: now() }), { created: false, ownedCount: 1 });
	assert.deepEqual(await defs.deleteReadlistDefinition({ userId: creator, slug: "missing" }), { deleted: false });
	assert.equal(await revisionOf(creator), 1);
	const veteran = await owner("definitions-veteran");
	const legacyList = slug => put(saves, { userId: veteran, url: "readplace:queue-def/" + slug, queueSlug: slug, queueLabel: slug, createdAt: now().toISOString() });
	for (let index = 0; index < 14; index++) await legacyList("legacy" + index);
	assert.equal(await revisionOf(veteran), undefined);
	const arrived = [];
	const barrier = { send: async command => {
		if (command instanceof TransactWriteCommand && arrived.length < 2) {
			await new Promise(resolve => { arrived.push(resolve); if (arrived.length === 2) arrived.forEach(go => go()); });
		}
		return client.send(command);
	} };
	const racing = initDynamoDbReadlistDefinitions({ client: barrier, userArticlesTableName: saves });
	const outcomes = await Promise.allSettled(["left", "right"].map(slug => racing.createReadlistDefinition({ userId: veteran, slug, label: slug, createdAt: now() })));
	assert.deepEqual(outcomes.filter(outcome => outcome.status === "fulfilled").map(outcome => outcome.value), [{ created: true, ownedCount: 15 }]);
	assert.deepEqual(outcomes.filter(outcome => outcome.status === "rejected").map(outcome => outcome.reason.name), ["ReadlistLimitReachedError"]);
	assert.equal(await revisionOf(veteran), 1);
	assert.equal((await defs.listReadlistDefinitions(veteran)).length, 15);
	await savedStore.deleteAllUserArticles(creator);
	assert.equal(await get(saves, { userId: creator, url: "readplace:queue-revision" }), undefined);

	// The supported maximum of 15 named readlists fits one 21-item transaction.
	const maxed = await owner("everywhere-maxed");
	for (let index = 0; index < 15; index++) await list(maxed, "list" + index);
	const crowded = await article(maxed, "crowded");
	for (let index = 0; index < 15; index++) await holding(maxed, "list" + index, crowded.key);
	transactionSizes.length = 0;
	assert.equal((await finish(await confirmed(maxed, [crowded.target]))).completed, 1);
	assert.equal(transactionSizes[0], 21);
	for (let index = 0; index < 15; index++) assert.equal((await row(maxed, crowded.key, "list" + index)).status, "read");

	// Unknown source matches the raw row: explicit NULL provenance is not unknown.
	const unknownSeed = async name => {
		const userId = await owner(name);
		await list(userId, "weekend");
		const missing = await article(userId, "missing-provenance");
		const nulled = await article(userId, "null-provenance", { provenance: null });
		await holding(userId, "weekend", nulled.key);
		return { userId, missing, nulled };
	};
	const savedArticles = new Map();
	const remember = (...items) => { for (const item of items) savedArticles.set(ReaderArticleHashId.from(item.url).value, { ...normalized(item.row), url: item.url, savedAt: new Date(item.row.savedAt) }); };
	const prepare = initBulkPreparation({ client, saves, emails: "unused", links: "unused", resolveCanonicalIdentity: async url => url,
		findArticleById: async (id, userId) => { const found = savedArticles.get(id.value); return found && found.userId === userId ? found : null; } });
	const pageReader = await unknownSeed("unknown-page");
	const listed = await client.send(new QueryCommand({ TableName: saves, IndexName: "userId-savedAt-index", KeyConditionExpression: "userId = :userId",
		FilterExpression: UNKNOWN_ORIGIN_FILTER, ExpressionAttributeValues: { ":userId": pageReader.userId, ":flag": true } }));
	assert.deepEqual(listed.Items.map(item => item.url), [pageReader.missing.key]);
	assert.equal((await finish(await confirmed(pageReader.userId, [pageReader.missing.target], { source: "unknown", extent: "page" }))).completed, 1);
	const allReader = await unknownSeed("unknown-all");
	remember(allReader.missing, allReader.nulled);
	const sparse = await owner("unknown-sparse");
	for (let index = 0; index < 32; index++) await article(sparse, "known-" + index, { provenance: { kind: "web" } });
	const sparseMatch = await article(sparse, "sparse-match");
	remember(sparseMatch);
	const prepared = async userId => {
		let job = newSelection(userId, spec({ source: "unknown" }), now());
		await store.create(job);
		const pages = [];
		while (job.state === "preparing") {
			const page = await prepare(job, () => 100_000);
			pages.push(page.targets.length);
			assert(await store.append(job, page.targets, page.next, now()));
			job = await header(job);
			assert(pages.length < 10);
		}
		return { job, pages };
	};
	const all = await prepared(allReader.userId);
	assert.equal(all.job.selected, 1);
	assert(await store.confirm(all.job, now()));
	assert.equal((await finish(all.job)).completed, 1);
	for (const reader_ of [pageReader, allReader]) {
		assert.equal((await row(reader_.userId, reader_.missing.key)).status, "read");
		assert.equal((await row(reader_.userId, reader_.nulled.key)).status, "unread");
		assert.equal((await row(reader_.userId, reader_.nulled.key, "weekend")).status, "unread");
	}
	const sparsePrepared = await prepared(sparse);
	assert.equal(sparsePrepared.job.selected, 1);
	assert.equal(sparsePrepared.pages[0], 0);

	// Target retention outlives the latest legal retry of a long preparation.
	const base = (Math.floor(now().getTime() / DAY) + 2) * DAY;
	const at = (hhmm, days = 0) => base + days * DAY + Number(hhmm.slice(0, 2)) * HOUR + Number(hhmm.slice(3)) * 60_000;
	setInstant(at("08:00"));
	const keeper = await owner("everywhere-retention");
	const kept = [];
	for (let index = 0; index < 3; index++) kept.push(await article(keeper, "kept-" + index));
	setInstant(at("09:00"));
	let retained = newSelection(keeper, spec(), now());
	await store.create(retained);
	const cap = at("09:00", 1) / 1000;
	const targetTtl = async item => (await get(saves, targetKey(retained, item.key))).expiresAt;
	for (const [index, time] of [[0, "09:00"], [1, "09:50"], [2, "10:30"]]) {
		setInstant(at(time));
		assert(await store.append(retained, [kept[index].target], index === 2 ? undefined : String(index), now()));
		retained = await header(retained);
		assert.equal(await targetTtl(kept[index]), cap + RETENTION_SECONDS);
	}
	assert.equal(retained.state, "preview");
	setInstant(at("10:45"));
	assert(await store.confirm(retained, now()));
	retained = await header(retained);
	assert.equal(retained.expiresAt, Math.floor(at("10:45", 30) / 1000));
	for (const item of kept) assert(await targetTtl(item) >= retained.expiresAt);
	assert(await store.fail(retained));
	setInstant(at("10:20", 30));
	const expireRecords = async userId => {
		const rows = await client.send(new QueryCommand({ TableName: saves, KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
			ExpressionAttributeNames: { "#url": "url" }, ExpressionAttributeValues: { ":userId": userId, ":prefix": "readplace:bulk-articles/" } }));
		const expired = rows.Items.filter(item => item.expiresAt <= Math.floor(now().getTime() / 1000));
		await Promise.all(expired.map(item => client.send(new DeleteCommand({ TableName: saves, Key: { userId, url: item.url } }))));
		return expired.length;
	};
	assert.equal(await expireRecords(keeper), 0);
	assert(await store.retry(await header(retained)));
	assert.deepEqual([(await finish(retained)).completed, (await row(keeper, kept[0].key)).status], [3, "read"]);

	// A missing target leaves a count deficit that never reports Finished.
	const short = await owner("everywhere-short");
	const shortItems = [await article(short, "a"), await article(short, "b"), await article(short, "c")];
	const shortJob = await confirmed(short, shortItems.map(item => item.target));
	await client.send(new DeleteCommand({ TableName: saves, Key: targetKey(shortJob, shortItems[1].key) }));
	await assert.rejects(execute(await header(shortJob), () => 100_000), /never settled/);
	const deficit = await header(shortJob);
	assert.deepEqual([deficit.state, deficit.completed, deficit.selected], ["running", 2, 3]);
	assert(await store.fail(deficit));
	assert.deepEqual([(await header(shortJob)).state, (await header(shortJob)).failed], ["failed", 1]);

	// An exhausted target leaves the cursor before it; redelivery finishes the rest and counts the committed one once.
	const steady = await owner("everywhere-steady");
	const steadyItems = [];
	for (let index = 0; index < 3; index++) steadyItems.push(await article(steady, "steady-" + index));
	const steadyJob = await confirmed(steady, steadyItems.map(item => item.target));
	const order = (await client.send(new QueryCommand({ TableName: saves, KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
		ExpressionAttributeNames: { "#url": "url" }, ExpressionAttributeValues: { ":userId": steady, ":prefix": "readplace:bulk-articles/" + steadyJob.id + "/target/" } }))).Items.map(item => item.target.key);
	const [first, second, third] = order;
	rejectKey = second;
	const stuck = await header(steadyJob);
	await assert.rejects(execute(stuck, () => 100_000), /kept changing/);
	rejectKey = undefined;
	const interrupted = await header(steadyJob);
	assert.deepEqual([interrupted.cursor, interrupted.generation, interrupted.completed], [undefined, stuck.generation, 1]);
	assert.deepEqual([(await row(steady, first)).statusRevision, (await row(steady, second)).status, (await row(steady, third)).status], [1, "unread", "unread"]);
	const finished = await finish(steadyJob);
	assert.deepEqual([finished.state, finished.completed, finished.skipped], ["completed", 3, 0]);
	for (const key of order) assert.deepEqual([(await row(steady, key)).status, (await row(steady, key)).statusRevision], ["read", 1]);
	assert.deepEqual(sideEffects, []);
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
