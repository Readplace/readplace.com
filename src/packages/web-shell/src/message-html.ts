import assert from "node:assert";
import { placeholdersOf } from "@packages/translations";
import Handlebars from "handlebars";

const LITERAL_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escapeLiteral(text: string): string {
	return text.replace(/[&<>"]/g, (char) => LITERAL_ESCAPES[char]);
}

function paramHtml(value: unknown): string {
	if (value instanceof Handlebars.SafeString) return value.toHTML();
	assert(typeof value === "string" || typeof value === "number", "A message param must be a string, a number or a SafeString");
	return Handlebars.Utils.escapeExpression(String(value));
}

export function messageHtml(message: string, params: Readonly<Record<string, unknown>>): Handlebars.SafeString {
	const expected = placeholdersOf(message);
	const given = Object.keys(params).sort();
	assert(
		expected.length === given.length && expected.every((name, index) => name === given[index]),
		`"${message}" takes the params {${expected.join("}, {")}}, got {${given.join("}, {")}}`,
	);
	const html = message
		.split(/(\{[^{}]+\})/)
		.map((segment, index) => (index % 2 === 1 ? paramHtml(params[segment.slice(1, -1)]) : escapeLiteral(segment)))
		.join("");
	return new Handlebars.SafeString(html);
}

const JS_STRING_ESCAPES: Readonly<Record<string, string>> = {
	"\\": "\\\\",
	"'": "\\'",
	"\n": "\\n",
	"\r": "\\r",
	"<": "\\u003c",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
};

export function toSingleQuotedJsString(message: string): string {
	return `'${message.replace(/[\\'\n\r<\u2028\u2029]/g, (char) => JS_STRING_ESCAPES[char])}'`;
}
