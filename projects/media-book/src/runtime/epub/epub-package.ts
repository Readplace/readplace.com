import { attribute, elementsNamed, parseXml, resolveZipPath, textOf } from "./xml-elements";
import { readZipEntry } from "./zip-entries";

export type EpubPackage = {
	title: string;
	authors: string[];
	spine: string[];
	navPath: string | undefined;
	ncxPath: string | undefined;
};

export function parseEpubPackage(bytes: Uint8Array): EpubPackage | "not-an-epub" {
	const containerXml = readZipEntry({ bytes, name: "META-INF/container.xml" });
	if (containerXml === undefined) return "not-an-epub";
	const opfPath = attribute({ element: elementsNamed({ within: parseXml(containerXml), name: "rootfile" })[0], name: "full-path" });
	const opfXml = opfPath === "" ? undefined : readZipEntry({ bytes, name: opfPath });
	if (opfXml === undefined) return "not-an-epub";
	const opf = parseXml(opfXml);

	const manifest = new Map(
		elementsNamed({ within: opf, name: "item" }).map((item) => [
			attribute({ element: item, name: "id" }),
			{
				path: resolveZipPath({ from: opfPath, href: attribute({ element: item, name: "href" }) }),
				properties: attribute({ element: item, name: "properties" }).split(" "),
			},
		]),
	);
	const spine = elementsNamed({ within: opf, name: "itemref" }).flatMap((itemref) => {
		const item = manifest.get(attribute({ element: itemref, name: "idref" }));
		return item === undefined ? [] : [item.path];
	});
	if (spine.length === 0) return "not-an-epub";

	const tocId = attribute({ element: elementsNamed({ within: opf, name: "spine" })[0], name: "toc" });
	return {
		title: textOf(elementsNamed({ within: opf, name: "title" })[0]) || "Untitled book",
		authors: elementsNamed({ within: opf, name: "creator" }).map(textOf).filter((name) => name !== ""),
		spine,
		navPath: [...manifest.values()].find((item) => item.properties.includes("nav"))?.path,
		ncxPath: manifest.get(tocId)?.path,
	};
}
