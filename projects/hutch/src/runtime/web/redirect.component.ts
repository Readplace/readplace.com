import type { Component, ParsedComponent } from "@packages/web-shell";

export interface Redirect {
	statusCode: 302 | 303;
	location: string;
}

export function RedirectComponent(redirect: Redirect): Component {
	return {
		to: (_mediaType): ParsedComponent => ({
			statusCode: redirect.statusCode,
			headers: { Location: redirect.location },
			body: "",
		}),
	};
}
