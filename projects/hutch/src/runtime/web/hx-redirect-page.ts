import type { Request, Response } from "express";
import { type Component, type ParsedComponent, sendComponent } from "@packages/web-shell";

/** Tells HTMX to navigate the whole browser to `url` via
 * `window.location.href = url`. Needed when an hx-boost form submit must
 * redirect to a different origin (e.g., Stripe Checkout): HTMX's default
 * XHR-follow of a 303 Location is a cross-origin XHR that can't swap into
 * `<main>`, so the page never leaves. */
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

export function redirectFullPage(req: Request, res: Response, url: string): void {
	if (req.get("HX-Request") === "true") {
		sendComponent(req, res, HxRedirectPage(url));
		return;
	}
	res.redirect(303, url);
}
