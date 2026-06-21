import type { Component } from "./component.types";
import { type AcceptNegotiable, wantsMarkdown } from "./content-negotiation";

export type SendableResponse = {
	status(code: number): SendableResponse;
	set(headers: Record<string, string>): SendableResponse;
	send(body: string): SendableResponse;
};

export function sendComponent(req: AcceptNegotiable, res: SendableResponse, component: Component): void {
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
