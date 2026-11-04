type PersonalLinkParamRule = {
	appliesTo: (hostname: string) => boolean;
	params: readonly string[];
};

const anyHost = (_hostname: string) => true;

const PERSONAL_LINK_PARAM_RULES: readonly PersonalLinkParamRule[] = [
	{ appliesTo: anyHost, params: ["_hsenc", "_hsmi"] },
	{ appliesTo: anyHost, params: ["mc_cid", "mc_eid"] },
	{ appliesTo: (hostname) => hostname === "quora.com" || hostname.endsWith(".quora.com"), params: ["qv_src"] },
	{ appliesTo: (hostname) => hostname === "www.ai-supremacy.com", params: ["token"] },
];

export function withoutPersonalLinkParams(url: string): string {
	if (!URL.canParse(url)) return url;
	const parsed = new URL(url);
	const present = PERSONAL_LINK_PARAM_RULES.filter((rule) => rule.appliesTo(parsed.hostname))
		.flatMap((rule) => rule.params)
		.filter((param) => parsed.searchParams.has(param));
	if (present.length === 0) return url;
	for (const param of present) parsed.searchParams.delete(param);
	return parsed.href;
}
