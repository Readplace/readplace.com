import type { Component, ParsedComponent } from "./component.types";

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
