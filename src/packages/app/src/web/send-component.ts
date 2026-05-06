import type { Response } from "express";
import type { Component } from "./component.types";

export function sendComponent(res: Response, component: Component): void {
	const parsed = component.to("text/html");
	res.status(parsed.statusCode).set(parsed.headers).send(parsed.body);
}
