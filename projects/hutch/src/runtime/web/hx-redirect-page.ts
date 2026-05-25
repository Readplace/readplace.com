import type { Component, ParsedComponent } from "./component.types";

/** Tells HTMX to navigate the whole browser to `url` via
 * `window.location.href = url`. Needed when an hx-boost form submit must
 * redirect to a different origin (e.g., Stripe Checkout): HTMX's default
 * XHR-follow of a 303 Location is a cross-origin XHR that can't swap into
 * `<main>`, so the page never leaves. Non-HTMX clients should be sent a
 * plain 303 by the caller instead; this component is only useful when
 * `HX-Request: true` is on the request. */
export function HxRedirectPage(url: string): Component {
	return {
		to: (mediaType): ParsedComponent => {
			if (mediaType !== "text/html") {
				return { statusCode: 406, headers: {}, body: "" };
			}
			return {
				statusCode: 200,
				headers: {
					"content-type": "text/html; charset=utf-8",
					"hx-redirect": url,
				},
				body: "",
			};
		},
	};
}
