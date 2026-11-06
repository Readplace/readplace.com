import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { placeholdersOf } from "./define-surface";
import Handlebars from "handlebars";
import { parseHTML } from "linkedom";

export type CopyTemplate = { readonly file: string; readonly source: string };

export type CopyViolation = { readonly file: string; readonly text: string };

export type CopyKeyUse = { readonly key: string | undefined; readonly hash: readonly string[] };

export type CopyKeyOf = (mustache: hbs.AST.MustacheStatement | hbs.AST.SubExpression) => CopyKeyUse | undefined;

const MUSTACHE_MARK = "";
const COPY_ATTRIBUTES = ["alt", "aria-label", "aria-description", "placeholder", "title"];
const COPY_META = /(^|:)(description|title)$/;

function isPath(node: hbs.AST.Node): node is hbs.AST.PathExpression {
	return node.type === "PathExpression";
}

function isStringLiteral(node: hbs.AST.Node | undefined): node is hbs.AST.StringLiteral {
	return node?.type === "StringLiteral";
}

export const helperKeyOf: CopyKeyOf = (mustache) => {
	if (!isPath(mustache.path) || mustache.path.original !== "t") return undefined;
	const [first] = mustache.params;
	return {
		key: isStringLiteral(first) ? first.value : undefined,
		hash: (mustache.hash?.pairs ?? []).map((pair) => pair.key),
	};
};

export const pathKeyOf: CopyKeyOf = (mustache) => {
	if (!isPath(mustache.path) || !mustache.path.original.startsWith("t.")) return undefined;
	return { key: mustache.path.original.slice(2), hash: [] };
};

class CopyCollector extends Handlebars.Visitor {
	readonly html: string[] = [];
	readonly uses: CopyKeyUse[] = [];

	constructor(private readonly keyOf: CopyKeyOf) {
		super();
	}

	ContentStatement(content: hbs.AST.ContentStatement): void {
		this.html.push(content.value);
	}

	MustacheStatement(mustache: hbs.AST.MustacheStatement): void {
		this.record(mustache);
		this.html.push(MUSTACHE_MARK);
		super.MustacheStatement(mustache);
	}

	SubExpression(expression: hbs.AST.SubExpression): void {
		this.record(expression);
		super.SubExpression(expression);
	}

	private record(node: hbs.AST.MustacheStatement | hbs.AST.SubExpression): void {
		const use = this.keyOf(node);
		if (use !== undefined) this.uses.push(use);
	}
}

function hasCopy(text: string, exemptTokens: readonly string[]): boolean {
	const stripped = exemptTokens.reduce((rest, token) => rest.replaceAll(token, " "), text.replaceAll(MUSTACHE_MARK, " "));
	return /\p{L}/u.test(stripped);
}

function collapse(text: string): string {
	return text.replaceAll(MUSTACHE_MARK, "{{…}}").replace(/\s+/g, " ").trim();
}

function literalCopy(html: string, exemptTokens: readonly string[]): string[] {
	const { document } = parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`);
	document.documentElement.normalize();
	const found: string[] = [];
	for (const element of document.querySelectorAll("*")) {
		const holdsCode = element.localName === "script" || element.localName === "style";
		const texts = holdsCode ? [] : [...element.childNodes].filter((child) => child.nodeType === 3).map((child) => String(child.textContent));
		found.push(...texts.filter((text) => hasCopy(text, exemptTokens)).map(collapse));
		const isCopyMeta = element.localName === "meta" && COPY_META.test(element.getAttribute("name") ?? element.getAttribute("property") ?? "");
		const attributes = isCopyMeta ? [...COPY_ATTRIBUTES, "content"] : COPY_ATTRIBUTES;
		for (const name of attributes) {
			const value = element.getAttribute(name);
			if (value !== null && hasCopy(value, exemptTokens)) found.push(`${name}="${collapse(value)}"`);
		}
	}
	return found;
}

function keyProblems(input: { uses: readonly CopyKeyUse[]; findMessage: (key: string) => string | undefined }): string[] {
	return input.uses.flatMap(({ key, hash }) => {
		if (key === undefined) return ["{{t}} needs a string-literal key"];
		const message = input.findMessage(key);
		if (message === undefined) return [`{{t}} names the unknown message "${key}"`];
		const expected = placeholdersOf(message).join(", ");
		const given = [...hash].sort().join(", ");
		return expected === given ? [] : [`{{t "${key}"}} takes {${expected}}, got {${given}}`];
	});
}

export function findCopyViolations(input: {
	readonly templates: readonly CopyTemplate[];
	readonly findMessage: (key: string) => string | undefined;
	readonly keyOf: CopyKeyOf;
	readonly exemptTokens: readonly string[];
}): CopyViolation[] {
	return input.templates.flatMap(({ file, source }) => {
		const collector = new CopyCollector(input.keyOf);
		collector.accept(Handlebars.parse(source));
		const problems = [
			...keyProblems({ uses: collector.uses, findMessage: input.findMessage }),
			...literalCopy(collector.html.join(""), input.exemptTokens),
		];
		return problems.map((text) => ({ file, text }));
	});
}

function filesUnder(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name))
		.sort();
}

async function templatesIn(input: { readonly root: string; readonly file: string }): Promise<CopyTemplate[]> {
	const relative = path.relative(input.root, input.file);
	if (input.file.endsWith(".template.html")) return [{ file: relative, source: readFileSync(input.file, "utf8") }];
	if (!input.file.endsWith(".template.js")) return [];
	const exported: Record<string, unknown> = await import(input.file);
	return Object.entries(exported).flatMap(([name, value]) =>
		typeof value === "string" ? [{ file: `${relative}#${name}`, source: value }] : [],
	);
}

export async function collectTemplates(input: {
	readonly root: string;
	readonly directories: readonly string[];
}): Promise<CopyTemplate[]> {
	const files = input.directories.flatMap((directory) => filesUnder(path.join(input.root, directory)));
	const found = await Promise.all(files.map((file) => templatesIn({ root: input.root, file })));
	return found.flat();
}
