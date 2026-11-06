import assert from "node:assert/strict";
import { initAnswerPopupMessage } from "./answer-popup-message";
import type { GuardedResult } from "./auth/auth.types";
import type { LoginReply } from "./core";
import { ReadingListItemIdSchema } from "./domain/reading-list-item-id";
import { PopupMessageSchema } from "./popup-protocol";
import type { CollectionPage, InvokeActionResult, LoadPageResult, SaveUrlResult } from "./reading-list/reading-list.types";

type FetchData = { page: number } | { sort: number };

const emptyPage: CollectionPage = { items: [], pages: [], total: undefined, sort: [] };

const savedReply: GuardedResult<SaveUrlResult> = {
	ok: true,
	value: {
		ok: true,
		item: {
			id: ReadingListItemIdSchema.parse("item-1"),
			url: "https://example.com/article",
			title: "An article",
			savedAt: new Date("2026-11-05T00:00:00.000Z"),
			actions: [],
			links: [],
			needsBrowserCapture: false,
		},
		messages: [],
	},
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

function flushMicrotasks(): Promise<void> {
	return new Promise((settle) => setImmediate(settle));
}

function answerWith(replies: {
	save?: GuardedResult<SaveUrlResult>;
	login?: LoginReply;
	invoke?: GuardedResult<InvokeActionResult>;
	fetch?: GuardedResult<CollectionPage>;
	loginPromptReport?: Promise<void>;
	enqueued?: Promise<void>;
	purged?: Promise<void>;
	forgotten?: Promise<void>;
}) {
	const callOrder: string[] = [];
	const saves: { url: string; title: string; tabId?: number }[] = [];
	const enqueues: { url: string; title?: string; tabId?: number }[] = [];
	const invokes: { id: string; name: string }[] = [];
	const fetches: { resource: string; data: FetchData | undefined }[] = [];
	const kept: Promise<unknown>[] = [];

	function fetchRecording(resource: "reading-list"): Promise<GuardedResult<CollectionPage>>;
	function fetchRecording(resource: "reading-list", data: FetchData): Promise<GuardedResult<LoadPageResult>>;
	function fetchRecording(resource: "reading-list", data?: FetchData): Promise<GuardedResult<CollectionPage>> {
		fetches.push({ resource, data });
		return Promise.resolve(replies.fetch ?? { ok: true, value: emptyPage });
	}

	const answerPopupMessage = initAnswerPopupMessage({
		core: {
			login: () => Promise.resolve(replies.login ?? { ok: true }),
			logout: () => {
				callOrder.push("core.logout");
			},
			save: (_resource, data) => {
				saves.push(data);
				return Promise.resolve(replies.save ?? savedReply);
			},
			invoke: (_resource, data) => {
				invokes.push(data);
				return Promise.resolve(replies.invoke ?? { ok: false, reason: "not-logged-in" });
			},
			fetch: fetchRecording,
		},
		reportLoginPrompt: () => replies.loginPromptReport ?? Promise.resolve(),
		uploadQueue: {
			enqueue: (target) => {
				enqueues.push(target);
				return replies.enqueued ?? Promise.resolve();
			},
			purge: () => {
				callOrder.push("purge");
				return replies.purged ?? Promise.resolve();
			},
		},
		forgetRuns: () => {
			callOrder.push("forget");
			return replies.forgotten ?? Promise.resolve();
		},
		keepAlive: <T>(work: Promise<T>) => {
			kept.push(work);
			return work;
		},
	});

	const answer = (raw: unknown) => answerPopupMessage(PopupMessageSchema.parse(raw));

	return { answer, callOrder, saves, enqueues, invokes, fetches, kept };
}

describe("initAnswerPopupMessage", () => {
	describe("save-current-tab", () => {
		const message = { type: "save-current-tab", url: "https://example.com/article", title: "An article", tabId: 7 } as const;
		const target = { url: "https://example.com/article", title: "An article", tabId: 7 };

		it("queues the page bytes once for a saved link and replies without waiting for them", async () => {
			const upload = deferred();
			const popup = answerWith({ save: savedReply, enqueued: upload.promise });

			const answered = popup.answer(message);
			const reply = await answered;

			assert.deepStrictEqual(reply, savedReply);
			assert.deepStrictEqual(popup.saves, [target]);
			assert.deepStrictEqual(popup.enqueues, [target]);
			assert.equal(popup.kept.length, 2);
			assert.equal(popup.kept[0], answered);
			assert.equal(popup.kept[1], upload.promise);
		});

		it("queues nothing for a link already saved", async () => {
			const alreadySaved: GuardedResult<SaveUrlResult> = { ok: true, value: { ok: false, reason: "already-saved" } };
			const popup = answerWith({ save: alreadySaved });

			const reply = await popup.answer(message);

			assert.deepStrictEqual(reply, alreadySaved);
			assert.deepStrictEqual(popup.enqueues, []);
		});

		it("queues nothing when the reader is not logged in", async () => {
			const notLoggedIn: GuardedResult<SaveUrlResult> = { ok: false, reason: "not-logged-in" };
			const popup = answerWith({ save: notLoggedIn });

			const reply = await popup.answer(message);

			assert.deepStrictEqual(reply, notLoggedIn);
			assert.deepStrictEqual(popup.enqueues, []);
		});
	});

	describe("logout", () => {
		it("starts the purge and the forget before logging out, and replies once both have settled", async () => {
			const purge = deferred();
			const forget = deferred();
			const popup = answerWith({ purged: purge.promise, forgotten: forget.promise });
			let settled = false;

			const answered = popup.answer({ type: "logout" });
			void answered.then(() => {
				settled = true;
			});

			assert.deepStrictEqual(popup.callOrder, ["purge", "forget", "core.logout"]);
			assert.equal(popup.kept.length, 1);

			await flushMicrotasks();
			assert.equal(settled, false);

			purge.resolve();
			await flushMicrotasks();
			assert.equal(settled, false);

			forget.resolve();
			assert.deepStrictEqual(await answered, { ok: true });
			assert.deepStrictEqual(await popup.kept[0], [undefined, undefined]);
		});
	});

	describe("login-prompt-shown", () => {
		it("replies ok when the prompt was reported", async () => {
			const popup = answerWith({ loginPromptReport: Promise.resolve() });

			assert.deepStrictEqual(await popup.answer({ type: "login-prompt-shown" }), { ok: true });
		});

		it("replies not ok when reporting the prompt failed", async () => {
			const popup = answerWith({ loginPromptReport: Promise.reject(new Error("report refused")) });

			assert.deepStrictEqual(await popup.answer({ type: "login-prompt-shown" }), { ok: false });
		});
	});

	describe("login", () => {
		it("passes through a successful sign-in", async () => {
			const popup = answerWith({ login: { ok: true } });

			assert.deepStrictEqual(await popup.answer({ type: "login" }), { ok: true });
		});

		it("passes through a failed sign-in with its error", async () => {
			const failedSignIn: LoginReply = { ok: false, reason: "error", error: new Error("window closed") };
			const popup = answerWith({ login: failedSignIn });

			assert.deepStrictEqual(await popup.answer({ type: "login" }), failedSignIn);
		});
	});

	describe("invoke-action", () => {
		it("forwards the item id and the action name", async () => {
			const notFound: GuardedResult<InvokeActionResult> = { ok: true, value: { ok: false, reason: "not-found" } };
			const popup = answerWith({ invoke: notFound });
			const id = ReadingListItemIdSchema.parse("item-1");

			const reply = await popup.answer({ type: "invoke-action", id, name: "delete" });

			assert.deepStrictEqual(reply, notFound);
			assert.deepStrictEqual(popup.invokes, [{ id: "item-1", name: "delete" }]);
		});
	});

	describe("reading list", () => {
		const firstPage: GuardedResult<CollectionPage> = {
			ok: true,
			value: { items: [], pages: [{ label: "1", rel: "current" }], total: undefined, sort: [] },
		};

		it("fetches the list with no data for get-all-items", async () => {
			const popup = answerWith({ fetch: firstPage });

			const reply = await popup.answer({ type: "get-all-items" });

			assert.deepStrictEqual(reply, firstPage);
			assert.deepStrictEqual(popup.fetches, [{ resource: "reading-list", data: undefined }]);
		});

		it("fetches the addressed page for load-page", async () => {
			const popup = answerWith({ fetch: firstPage });

			const reply = await popup.answer({ type: "load-page", index: 3 });

			assert.deepStrictEqual(reply, firstPage);
			assert.deepStrictEqual(popup.fetches, [{ resource: "reading-list", data: { page: 3 } }]);
		});

		it("fetches the addressed sort for load-sort", async () => {
			const popup = answerWith({ fetch: firstPage });

			const reply = await popup.answer({ type: "load-sort", index: 1 });

			assert.deepStrictEqual(reply, firstPage);
			assert.deepStrictEqual(popup.fetches, [{ resource: "reading-list", data: { sort: 1 } }]);
		});
	});
});
