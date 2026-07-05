interface SirenField {
	name: string;
	type: string;
	value?: string | number;
}

export interface SirenAction {
	name: string;
	href: string;
	method: string;
	title?: string;
	type?: string;
	fields?: SirenField[];
	/* A reserved semantic-role token the client maps to its own presentation
	 * (e.g. ["destructive"] → a red, confirm-gated control). The server never
	 * sends a CSS class; presentation stays entirely client-side. */
	class?: string[];
}

export interface SirenLink {
	rel: string[];
	href: string;
	title?: string;
}

export interface SirenEntity {
	class?: string[];
	properties?: Record<string, unknown>;
	entities?: SirenSubEntity[];
	links?: SirenLink[];
	actions?: SirenAction[];
}

export interface SirenSubEntity extends SirenEntity {
	rel: string[];
}

export const SIREN_MEDIA_TYPE = "application/vnd.siren+json";

/** A server-authored message a client renders generically — it carries no
 * feature-specific code or action. `type` selects presentation (a soft warning
 * the user can move past vs a hard error); `content` is an HTML fragment the
 * client injects into a generic message view. The same shape is used for every
 * message the server asks a client to surface. */
export interface SirenMessage {
	type: "warning" | "error";
	content: { type: "text/html"; body: string };
}

export function sirenError(error: {
	code: string;
	message: string;
	actions?: SirenAction[];
}): SirenEntity {
	const entity: SirenEntity = {
		class: ["error"],
		properties: { code: error.code, message: error.message },
	};
	if (error.actions) entity.actions = error.actions;
	return entity;
}

/** An error entity that carries only server-authored messages for the client to
 * render — no code, no action. A client keys off the presence of `messages`
 * rather than a per-feature code, so the same shape works for any "we can't do
 * this, here's why" refusal. */
export function sirenMessages(messages: SirenMessage[]): SirenEntity {
	return { class: ["error"], properties: { messages } };
}
