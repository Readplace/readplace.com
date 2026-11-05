import type { SaveAllRuns } from "./bulk-save-run/save-all-runs";
import type { Core } from "./core";
import type { PopupMessage, PopupReplies, PopupReply, PopupReplyFor } from "./popup-protocol";
import type { UploadQueue } from "./upload-queue/upload-queue.types";

type PopupMessageOf = { [M in PopupMessage as M["type"]]: M };

export type AnswerPopupMessage = <M extends PopupMessage>(message: M) => Promise<PopupReplyFor<M>>;

export function initAnswerPopupMessage(deps: {
	core: Pick<Core, "login" | "logout" | "save" | "invoke" | "fetch">;
	reportLoginPrompt: () => Promise<void>;
	uploadQueue: Pick<UploadQueue, "enqueue" | "purge">;
	forgetRuns: SaveAllRuns["forget"];
	keepAlive: <T>(work: Promise<T>) => Promise<T>;
}): AnswerPopupMessage {
	const answers: { [K in PopupMessage["type"]]: (message: PopupMessageOf[K]) => Promise<PopupReplies[K]> } = {
		"login-prompt-shown": () =>
			deps.reportLoginPrompt().then(
				() => ({ ok: true }),
				() => ({ ok: false }),
			),
		login: () => deps.core.login(),
		logout: () => {
			/** Page bytes captured for a signed-in reader must not outlive the
			 * session that authorised capturing them. */
			const purged = deps.keepAlive(Promise.all([deps.uploadQueue.purge(), deps.forgetRuns()]));
			deps.core.logout();
			return purged.then(() => ({ ok: true }));
		},
		"save-current-tab": (message) => {
			const target = { url: message.url, title: message.title, tabId: message.tabId };
			return deps.keepAlive(
				deps.core.save("current-tab", target).then((reply) => {
					if (reply.ok && reply.value.ok) void deps.keepAlive(deps.uploadQueue.enqueue(target));
					return reply;
				}),
			);
		},
		"invoke-action": (message) => deps.core.invoke("item-action", { id: message.id, name: message.name }),
		"get-all-items": () => deps.core.fetch("reading-list"),
		"load-page": (message) => deps.core.fetch("reading-list", { page: message.index }),
		"load-sort": (message) => deps.core.fetch("reading-list", { sort: message.index }),
	};

	function dispatch<K extends PopupMessage["type"]>(type: K, message: PopupMessageOf[K]): Promise<PopupReplies[K]> {
		return answers[type](message);
	}

	function answerPopupMessage<M extends PopupMessage>(message: M): Promise<PopupReplyFor<M>>;
	function answerPopupMessage(message: PopupMessage): Promise<PopupReply> {
		return dispatch(message.type, message);
	}

	return answerPopupMessage;
}
