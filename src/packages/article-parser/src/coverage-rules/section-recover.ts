import assert from "node:assert";
import parseSrcset from "parse-srcset";
import { isElement, isUnowned, tagOf } from "./owned-nodes";

const LAZY_SRC_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original"];

function restoreLazyImage(img: Element): void {
	const lazySrcset = img.getAttribute("data-srcset");
	const lazy = [
		...LAZY_SRC_ATTRIBUTES.flatMap((name) => {
			const value = img.getAttribute(name);
			return value === null ? [] : [value];
		}),
		...(lazySrcset === null ? [] : parseSrcset(lazySrcset).map((entry) => entry.url)),
	];
	if (lazy.length > 0) {
		img.setAttribute("src", lazy[0]);
	}
	if (lazySrcset !== null) {
		img.setAttribute("srcset", lazySrcset);
	}
}

export function recoverSection(params: { root: Element }): { bodyHtml: string } {
	const clone = params.root.cloneNode(true);
	assert(isElement(clone), "a cloned element is an element");
	const sources = [...params.root.querySelectorAll("*")];
	const clones = [...clone.querySelectorAll("*")];
	sources.forEach((source, index) => {
		if (isUnowned(source)) {
			clones[index].remove();
		} else if (tagOf(source) === "img") {
			restoreLazyImage(clones[index]);
		}
	});
	return { bodyHtml: clone.innerHTML };
}
