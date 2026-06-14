import { buildMessageView } from "./message-view";
import type { Message } from "../reading-list/reading-list.types";

function warning(body: string): Message {
	return { type: "warning", content: { type: "text/html", body } };
}

function error(body: string): Message {
	return { type: "error", content: { type: "text/html", body } };
}

describe("buildMessageView", () => {
	it("hides the view and renders nothing when there are no messages", () => {
		const view = buildMessageView([]);

		expect(view.hidden).toBe(true);
		expect(view.items).toEqual([]);
		expect(view.role).toBe("status");
	});

	it("renders a warning with the polite role and the warning variant class", () => {
		const view = buildMessageView([warning("<a href=\"mailto:x@y.z\">email</a>")]);

		expect(view.hidden).toBe(false);
		expect(view.role).toBe("status");
		expect(view.items).toEqual([
			{
				className: "messages__item messages__item--warning",
				html: "<a href=\"mailto:x@y.z\">email</a>",
			},
		]);
	});

	it("renders an error with the assertive role and the error variant class", () => {
		const view = buildMessageView([error("Something failed")]);

		expect(view.hidden).toBe(false);
		expect(view.role).toBe("alert");
		expect(view.items).toEqual([
			{ className: "messages__item messages__item--error", html: "Something failed" },
		]);
	});

	it("upgrades the role to assertive when any message is an error", () => {
		const view = buildMessageView([warning("heads up"), error("broke")]);

		expect(view.role).toBe("alert");
		expect(view.items.map((item) => item.className)).toEqual([
			"messages__item messages__item--warning",
			"messages__item messages__item--error",
		]);
	});

	it("passes the server-authored body through verbatim", () => {
		const body = "Your account is locked. Email <a href=\"mailto:support\">support</a>.";

		const view = buildMessageView([warning(body)]);

		expect(view.items[0].html).toBe(body);
	});
});
