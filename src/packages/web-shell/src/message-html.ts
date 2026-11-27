import assert from "node:assert";
import { assertParams } from "@packages/translations";
import Handlebars from "handlebars";

function paramHtml(value: unknown): string {
	if (value instanceof Handlebars.SafeString) return value.toHTML();
	assert(typeof value === "string" || typeof value === "number", "A message param must be a string, a number or a SafeString");
	return Handlebars.Utils.escapeExpression(String(value));
}

export function messageHtml(message: string, params: Readonly<Record<string, unknown>>): Handlebars.SafeString {
	assertParams({ message, names: Object.keys(params) });
	const html = message
		.split(/(\{[^{}]+\})/)
		.map((segment, index) => (index % 2 === 1 ? paramHtml(params[segment.slice(1, -1)]) : Handlebars.Utils.escapeExpression(segment)))
		.join("");
	return new Handlebars.SafeString(html);
}
