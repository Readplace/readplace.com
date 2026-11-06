import type { BrowserEgress } from "../../domain/render-crawl/render-page.types";

const LAUNCH_ARGS = ["--block-new-web-contents"];

function egressArgs(egress: BrowserEgress): string[] {
	if (egress.kind === "direct") return [];
	const proxyServer = `--proxy-server=${egress.proxy.server}`;
	return egress.kind === "web-unlocker" ? [proxyServer, "--ignore-certificate-errors"] : [proxyServer];
}

export function browserLaunchArgs(params: { inheritedArgs: readonly string[]; egress: BrowserEgress }): string[] {
	return [...params.inheritedArgs, ...LAUNCH_ARGS, ...egressArgs(params.egress)];
}
