import type { SirenMessage } from "./siren";

/**
 * The notice the iOS Share Extension shows beneath "Saving…" while a save is in
 * flight. The extension is a short-lived process, so swiping it away in the app
 * switcher kills the save mid-upload; the server authors this caption to
 * discourage that. Server-authored (not hardcoded in the app) so the copy can
 * change without an App Store release, and gated to the iOS client at the call
 * site — no other client is offered it. A static constant, so there is nothing
 * to interpolate and nothing to escape (the hypermedia trusted-HTML invariant).
 */
export function saveInProgressNotice(): SirenMessage[] {
	return [
		{
			type: "warning",
			content: {
				type: "text/html",
				body: "Don't close this — it's still saving.",
			},
		},
	];
}
