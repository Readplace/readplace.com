import type { CspNonce } from "./csp-nonce.middleware";

export function htmxScripts(cspNonce: CspNonce): string {
	return `<script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js" integrity="sha384-/TgkGk7p307TH7EXJDuUlgG3Ce1UVolAOFopFekQkkXihi5u/6OCvVKyz1W+idaz" crossorigin="anonymous"></script><script nonce="${cspNonce}">htmx.config.scrollBehavior='smooth';</script>`;
}
