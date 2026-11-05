import { DOMParser } from "linkedom";

type XmlElement = ReturnType<XmlDocument["querySelectorAll"]>[number];
type XmlDocument = ReturnType<DOMParser["parseFromString"]>;

export function parseXml(xml: string): XmlDocument {
	return new DOMParser().parseFromString(xml, "text/xml");
}

function localName(element: XmlElement): string {
	const name = element.tagName;
	return name.slice(name.indexOf(":") + 1).toLowerCase();
}

export function elementsNamed(params: { within: XmlDocument | XmlElement; name: string }): XmlElement[] {
	return [...params.within.querySelectorAll("*")].filter((element) => localName(element) === params.name);
}

export function resolveZipPath(params: { from: string; href: string }): string {
	const base = params.from.split("/").slice(0, -1);
	for (const segment of decodeURIComponent(params.href).split("/")) {
		if (segment === "..") base.pop();
		else if (segment !== "." && segment !== "") base.push(segment);
	}
	return base.join("/");
}

export function attribute(params: { element: XmlElement | undefined; name: string }): string {
	return params.element?.getAttribute(params.name) ?? "";
}

export function textOf(element: XmlElement | undefined): string {
	return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
