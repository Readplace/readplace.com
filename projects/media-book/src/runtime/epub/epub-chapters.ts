import type { EpubPackage } from "./epub-package";
import { attribute, elementsNamed, parseXml, resolveZipPath, textOf } from "./xml-elements";
import { readZipEntry } from "./zip-entries";

export type EpubChapter = { path: string; title: string; xhtml: string };

export function tocTitlesFrom(params: { pkg: EpubPackage; navXml: string | undefined; ncxXml: string | undefined }): Map<string, string> {
	const titles = new Map<string, string>();
	const record = (from: string, href: string, title: string) => {
		const path = resolveZipPath({ from, href: href.split("#")[0] });
		if (title !== "" && !titles.has(path)) titles.set(path, title);
	};
	const { navPath, ncxPath } = params.pkg;
	const { navXml, ncxXml } = params;
	if (navPath !== undefined && navXml !== undefined) {
		for (const anchor of elementsNamed({ within: parseXml(navXml), name: "a" })) {
			record(navPath, attribute({ element: anchor, name: "href" }), textOf(anchor));
		}
	}
	if (ncxPath !== undefined && ncxXml !== undefined) {
		for (const navPoint of elementsNamed({ within: parseXml(ncxXml), name: "navpoint" })) {
			const content = elementsNamed({ within: navPoint, name: "content" })[0];
			record(ncxPath, attribute({ element: content, name: "src" }), textOf(elementsNamed({ within: navPoint, name: "text" })[0]));
		}
	}
	return titles;
}

export function chapterTitle(params: { titles: ReadonlyMap<string, string>; path: string; index: number }): string {
	return params.titles.get(params.path) ?? `Chapter ${params.index + 1}`;
}

export function readEpubChapters(params: { bytes: Uint8Array; pkg: EpubPackage }): EpubChapter[] {
	const read = (path: string | undefined) => (path === undefined ? undefined : readZipEntry({ bytes: params.bytes, name: path }));
	const titles = tocTitlesFrom({ pkg: params.pkg, navXml: read(params.pkg.navPath), ncxXml: read(params.pkg.ncxPath) });
	return params.pkg.spine.flatMap((path, index) => {
		const xhtml = read(path);
		return xhtml === undefined ? [] : [{ path, title: chapterTitle({ titles, path, index }), xhtml }];
	});
}
