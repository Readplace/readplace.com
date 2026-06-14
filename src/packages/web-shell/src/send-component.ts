import type { Request, Response } from "express";
import type { Component } from "./component.types";
import { wantsMarkdown } from "./content-negotiation";

export function sendComponent(req: Request, res: Response, component: Component): void {
	if (wantsMarkdown(req)) {
		const md = component.to("text/markdown");
		if (md.statusCode !== 406) {
			res.status(md.statusCode).set(md.headers).send(md.body);
			return;
		}
	}
	const parsed = component.to("text/html");
	res.status(parsed.statusCode).set(parsed.headers).send(parsed.body);
}
