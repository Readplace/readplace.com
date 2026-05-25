import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { ACCOUNT_STYLES } from "./account.styles";

const TEMPLATE = readFileSync(join(__dirname, "payment-method-success.template.html"), "utf-8");

const AUTO_SUBMIT_SCRIPT = `
<script>
	(function () {
		function run() {
			var form = document.querySelector('[data-auto-submit]');
			if (form) form.requestSubmit();
		}
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', run, { once: true });
		} else {
			run();
		}
	})();
</script>
`;

export function PaymentMethodSuccessPage(vm: { sessionId: string; finalizeUrl: string }): PageBody {
	return {
		seo: {
			title: "Saving payment method — Readplace",
			description: "Saving your payment method.",
			canonicalUrl: "/account",
			robots: "noindex, nofollow",
		},
		styles: ACCOUNT_STYLES,
		bodyClass: "page-account",
		content: { html: `${render(TEMPLATE, vm)}\n${AUTO_SUBMIT_SCRIPT}` },
	};
}
