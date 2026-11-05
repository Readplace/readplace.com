import type { EpubPackage } from "./epub-package";
import { attribute, elementsNamed, parseXml, resolveZipPath, textOf } from "./xml-elements";
import { readZipEntry } from "./zip-entries";

export type EpubChapter = { path: string; title: string; xhtml: string };

function tocTitles(params: { bytes: Uint8Array; pkg: EpubPackage }): Map<string, string> {
	const titles = new Map<string, string>();
	const record = (from: string, href: string, title: string) => {
		const path = resolveZipPath({ from, href: href.split("#")[0] });
		if (title !== "" && !titles.has(path)) titles.set(path, title);
	};
	const { navPath, ncxPath } = params.pkg;
	const navXml = navPath === undefined ? undefined : readZipEntry({ bytes: params.bytes, name: navPath });
	if (navPath !== undefined && navXml !== undefined) {
		for (const anchor of elementsNamed({ within: parseXml(navXml), name: "a" })) {
			record(navPath, attribute({ element: anchor, name: "href" }), textOf(anchor));
		}
	}
	const ncxXml = ncxPath === undefined ? undefined : readZipEntry({ bytes: params.bytes, name: ncxPath });
	if (ncxPath !== undefined && ncxXml !== undefined) {
		for (const navPoint of elementsNamed({ within: parseXml(ncxXml), name: "navpoint" })) {
			const content = elementsNamed({ within: navPoint, name: "content" })[0];
			record(ncxPath, attribute({ element: content, name: "src" }), textOf(elementsNamed({ within: navPoint, name: "text" })[0]));
		}
	}
	return titles;
}

export function readEpubChapters(params: { bytes: Uint8Array; pkg: EpubPackage }): EpubChapter[] {
	const titles = tocTitles(params);
	return params.pkg.spine.flatMap((path, index) => {
		const xhtml = readZipEntry({ bytes: params.bytes, name: path });
		return xhtml === undefined ? [] : [{ path, title: titles.get(path) ?? `Chapter ${index + 1}`, xhtml }];
	});
}
