import assert from "node:assert";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from "./locale";
import type {
	LeafPath,
	LocaleOf,
	MessageAt,
	MessageTree,
	NonEmptyLeaves,
	Params,
	PluralParams,
	PluralPath,
} from "./message.types";

type MessageNode = string | { readonly [key: string]: MessageNode };

export type Surface<M extends MessageTree> = {
	readonly purpose: string;
	readonly nonEmpty: boolean;
	readonly defaultMessages: M;
	readonly locales: { readonly [locale: string]: MessageNode };
};

const PLACEHOLDER = /\{([^{}]+)\}/g;

export function placeholdersOf(message: string): string[] {
	return [...new Set(Array.from(message.matchAll(PLACEHOLDER), (match) => match[1]))].sort();
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

function parseNode(value: unknown, path: string): MessageNode {
	if (typeof value === "string") return value;
	assert(typeof value === "object" && value !== null, `Message "${path}" must be a string or a nested tree`);
	const entries = Object.entries(value).map(([key, child]): [string, MessageNode] => {
		assert(key.length > 0 && !key.includes("."), `Message key "${key}" under "${path}" must be non-empty and contain no dot`);
		return [key, parseNode(child, path ? `${path}.${key}` : key)];
	});
	return Object.fromEntries(entries);
}

function leavesOf(node: MessageNode, path: string): Array<{ path: string; message: string }> {
	if (typeof node === "string") return [{ path, message: node }];
	return Object.entries(node).flatMap(([key, child]) => leavesOf(child, path ? `${path}.${key}` : key));
}

function assertSameShape(input: { locale: string; expected: MessageNode; actual: MessageNode; path: string }): void {
	const { locale, expected, actual, path } = input;
	if (typeof expected === "string") {
		assert(typeof actual === "string", `${locale} "${path}" must be a string`);
		assert(
			sameNames(placeholdersOf(expected), placeholdersOf(actual)),
			`${locale} "${path}" must use the placeholders {${placeholdersOf(expected).join("}, {")}}`,
		);
		return;
	}
	assert(typeof actual === "object", `${locale} "${path}" must be a nested tree`);
	assert(
		sameNames(Object.keys(expected).sort(), Object.keys(actual).sort()),
		`${locale} "${path || "(root)"}" must have exactly the keys ${Object.keys(expected).sort().join(", ")}`,
	);
	for (const [key, child] of Object.entries(expected)) {
		assertSameShape({ locale, expected: child, actual: actual[key], path: path ? `${path}.${key}` : key });
	}
}

export function defineSurface<const M extends MessageTree, N extends true | undefined = undefined>(input: {
	readonly purpose: string;
	readonly nonEmpty?: N;
	readonly defaultMessages: M & (N extends true ? NoInfer<NonEmptyLeaves<M>> : unknown);
	readonly otherLocales: {
		readonly [L in Exclude<SupportedLocale, typeof DEFAULT_LOCALE>]: NoInfer<LocaleOf<M>>;
	};
}): Surface<M> {
	assert(input.purpose.trim().length > 0, "A surface must state its purpose");
	const defaultTree = parseNode(input.defaultMessages, "");
	const others = Object.entries(input.otherLocales).map(([locale, tree]): [string, MessageNode] => {
		const parsed = parseNode(tree, "");
		assertSameShape({ locale, expected: defaultTree, actual: parsed, path: "" });
		return [locale, parsed];
	});
	const locales = Object.fromEntries([[DEFAULT_LOCALE, defaultTree], ...others]);
	for (const locale of SUPPORTED_LOCALES) {
		assert(locales[locale] !== undefined, `The surface "${input.purpose}" has no messages for ${locale}`);
	}
	const nonEmpty = input.nonEmpty === true;
	if (nonEmpty) {
		for (const [locale, tree] of Object.entries(locales)) {
			for (const leaf of leavesOf(tree, "")) {
				assert(leaf.message.length > 0, `${locale} "${leaf.path}" must not be empty`);
			}
		}
	}
	return {
		purpose: input.purpose,
		nonEmpty,
		defaultMessages: input.defaultMessages,
		locales,
	};
}

export function lookupMessage(tree: MessageNode, key: string): MessageNode | undefined {
	return key.split(".").reduce<MessageNode | undefined>(
		(node, part) => (typeof node === "object" ? node[part] : undefined),
		tree,
	);
}

export function assertParams(input: { readonly message: string; readonly names: readonly string[] }): void {
	const expected = placeholdersOf(input.message);
	const given = [...input.names].sort();
	assert(
		sameNames(expected, given),
		`"${input.message}" takes the params {${expected.join("}, {")}}, got {${given.join("}, {")}}`,
	);
}

export function fill(message: string, params: object): string {
	const values = new Map(Object.entries(params));
	assertParams({ message, names: [...values.keys()] });
	return message.replace(PLACEHOLDER, (_match, name: string) => String(values.get(name)));
}

export type Translator<M extends MessageTree> = {
	readonly t: <P extends LeafPath<M>>(key: P, ...params: Params<MessageAt<M, P>>) => string;
	readonly tPlural: <P extends PluralPath<M>>(key: P, params: PluralParams<MessageAt<M, P>>) => string;
};

export function translator<M extends MessageTree>(surface: Surface<M>, locale: SupportedLocale): Translator<M> {
	const tree = surface.locales[locale];
	assert(tree !== undefined, `The surface "${surface.purpose}" has no messages for ${locale}`);
	const rules = new Intl.PluralRules(locale);
	const t = (key: string, ...params: object[]): string => {
		const message = lookupMessage(tree, key);
		assert(typeof message === "string", `No ${locale} message at "${key}"`);
		return fill(message, params.length === 0 ? {} : params[0]);
	};
	const tPlural = (key: string, params: { readonly count: number }): string => {
		const forms = lookupMessage(tree, key);
		assert(typeof forms === "object", `No ${locale} plural message at "${key}"`);
		const formMessages = Object.entries(forms).map(([name, form]) => {
			assert(typeof form === "string", `The "${name}" form at "${key}" must be a string`);
			return form;
		});
		const allowed = new Set(["count", ...formMessages.flatMap(placeholdersOf)]);
		const given = Object.entries(params);
		assert(
			given.every(([name]) => allowed.has(name)),
			`"${key}" takes the params {${[...allowed].sort().join("}, {")}}`,
		);
		const form = rules.select(params.count);
		const message = forms[form];
		assert(typeof message === "string", `No ${locale} "${form}" form at "${key}"`);
		const used = new Set(placeholdersOf(message));
		return fill(message, Object.fromEntries(given.filter(([name]) => used.has(name))));
	};
	return { t, tPlural };
}

export type WebCatalog = {
	readonly findMessage: (input: { readonly locale: SupportedLocale; readonly key: string }) => string | undefined;
	readonly keys: () => readonly string[];
};

export function combineSurfaces(surfaces: Readonly<Record<string, Surface<MessageTree>>>): WebCatalog {
	const owners = new Map<string, string>();
	for (const [name, surface] of Object.entries(surfaces)) {
		for (const namespace of Object.keys(surface.defaultMessages)) {
			const owner = owners.get(namespace);
			assert(owner === undefined, `The page namespace "${namespace}" is defined by both ${owner} and ${name}`);
			owners.set(namespace, name);
		}
	}
	const all = Object.values(surfaces);
	return {
		findMessage: ({ locale, key }) => {
			const owner = owners.get(key.split(".")[0]);
			if (owner === undefined) return undefined;
			const tree = surfaces[owner].locales[locale];
			assert(tree !== undefined, `The surface ${owner} has no messages for ${locale}`);
			const message = lookupMessage(tree, key);
			return typeof message === "string" ? message : undefined;
		},
		keys: () => all.flatMap((surface) => leavesOf(parseNode(surface.defaultMessages, ""), "").map((leaf) => leaf.path)),
	};
}
