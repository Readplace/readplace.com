import type { parseHTML } from "linkedom";

const TRACKING_KEYS: ReadonlySet<string> = new Set(["nw_section", "sc_eh", "sc_lid", "sc_llid", "sc_src", "sc_uid", "usrhash", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term"]);
const NOTICE_TAGS: ReadonlySet<string> = new Set(["HTML", "HEAD", "BODY", "META", "STYLE", "A"]);
const NOTICE_STYLE = "body { color: #555; font-family: Arial, Verdana, Helvetica, sans-serif; font-weight: normal; font-size: 11px; } a { color: #555; }";
const NOTICE_ATTRIBUTES: ReadonlySet<string> = new Set(["http-equiv", "content", "href", "charset", "lang"]);

export function publisherPublicRefreshTarget(params: {
	document: ReturnType<typeof parseHTML>["document"];
	documentUrl: string;
	httpStatus: number;
	refreshCount: number;
	declaration: string;
	declaredTarget: string;
	target: URL;
}): string | undefined {
	const { document, target } = params;
	const source = URL.parse(params.documentUrl);
	if (source === null || source.protocol !== "https:" || source.hostname !== "link.camper.com" || source.pathname !== "/u/nrd.php" || source.port !== "" || source.username !== "" || source.password !== "" || params.documentUrl.includes("#") || params.httpStatus !== 200) return undefined;
	if (params.refreshCount !== 1 || !/^\s*0\s*[;,]\s*url\s*=/i.test(params.declaration)) return undefined;
	if (target.protocol !== "https:" || target.hostname !== "www.camper.com" || target.port !== "" || target.username !== "" || target.password !== "" || params.declaredTarget.includes("#")) return undefined;
	if (params.declaredTarget !== target.href) return undefined;
	const faq = target.pathname === "/int/at_cliente_faq";
	if (!faq && target.pathname !== "/html/legal/pdfs/privacy/general_privacy_policy_EN.pdf") return undefined;
	const keys = [...target.searchParams.keys()];
	if (new Set(keys).size !== keys.length || keys.some((key) => !(TRACKING_KEYS.has(key) || (faq && key === "faq")))) return undefined;
	if (faq && !/^[1-9][0-9]$/.test(target.searchParams.get("faq") ?? "")) return undefined;
	if ([...document.querySelectorAll("*")].some((element) => !NOTICE_TAGS.has(element.tagName) || [...element.attributes].some((attribute) => {
		const name = attribute.name.toLowerCase();
		return !NOTICE_ATTRIBUTES.has(name) && !(element.tagName === "STYLE" && name === "type" && attribute.value === "text/css") && !(element.tagName === "A" && name === "id" && attribute.value === "redir");
	}))) return undefined;
	const styles = [...document.querySelectorAll("style")];
	if (styles.length > 1 || styles.some((style) => style.getAttribute("type") !== "text/css" || style.attributes.length !== 1 || style.innerHTML.replace(/\s+/g, " ").trim() !== NOTICE_STYLE)) return undefined;
	const [anchor, ...otherAnchors] = document.querySelectorAll("a");
	if (anchor === undefined || otherAnchors.length > 0) return undefined;
	if ([...anchor.attributes].some((attribute) => !["href", "id"].includes(attribute.name.toLowerCase()))) return undefined;
	const href = URL.parse(anchor.getAttribute("href") ?? "", params.documentUrl);
	if (href?.href !== target.href) return undefined;
	if (document.body.innerText.replace(/\s+/g, " ").trim() !== "If you are not redirected, please click here") return undefined;
	const bare = new URL(target.href);
	for (const key of TRACKING_KEYS) bare.searchParams.delete(key);
	return bare.href;
}
