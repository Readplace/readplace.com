import assert from "node:assert/strict";
import { INBOX_EMAIL_DETAIL_STYLES } from "./inbox-email-detail.styles";
import { INBOX_EMAILS_STYLES } from "./inbox-emails.styles";
import { INBOX_STYLES } from "./inbox.styles";

function containerMaxWidth({ css, className }: { css: string; className: string }): number {
	const block = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
	assert(block, `expected a .${className} { … } rule in the stylesheet`);
	const declaration = block[1].match(/max-width:\s*(\d+)px/);
	assert(declaration, `expected a max-width in the .${className} rule`);
	return Number(declaration[1]);
}

describe("inbox container widths", () => {
	it("keeps the list, emails, and detail containers at one width so the content edge does not shift between them", () => {
		const detailWidth = containerMaxWidth({
			css: INBOX_EMAIL_DETAIL_STYLES,
			className: "inbox-email-detail",
		});
		const listWidth = containerMaxWidth({ css: INBOX_STYLES, className: "inbox" });
		const emailsWidth = containerMaxWidth({ css: INBOX_EMAILS_STYLES, className: "inbox-emails" });

		assert.equal(listWidth, detailWidth);
		assert.equal(emailsWidth, detailWidth);
	});
});
