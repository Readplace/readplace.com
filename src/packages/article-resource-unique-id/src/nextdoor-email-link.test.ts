import assert from "node:assert/strict";
import { toNextdoorPostUrl } from "./nextdoor-email-link";

const EMAIL_QUERY = "?share_token=dummyShare&auto_token=dummyAuto&ct=dummyCt&ec=dummyEc&mobile_deeplink_data=dummyDeeplink";

describe("toNextdoorPostUrl", () => {
	it("saves a Nextdoor email post link as the public post page without its sign-in tokens", () => {
		assert.equal(
			toNextdoorPostUrl(`https://nextdoor.co.uk/p/ExamplePost123${EMAIL_QUERY}`),
			"https://nextdoor.co.uk/p/ExamplePost123",
		);
	});

	it("saves a Nextdoor email post link with a trailing slash as the public post page", () => {
		assert.equal(
			toNextdoorPostUrl(`https://nextdoor.co.uk/p/ExamplePost123/${EMAIL_QUERY}#comments`),
			"https://nextdoor.co.uk/p/ExamplePost123",
		);
	});

	it.each([
		"not a url",
		"https://nextdoor.co.uk/p/ExamplePost123",
		`https://nextdoor.co.uk/news_feed/${EMAIL_QUERY}`,
		`https://nextdoor.co.uk/p/ExamplePost123/comments${EMAIL_QUERY}`,
		`http://nextdoor.co.uk/p/ExamplePost123${EMAIL_QUERY}`,
		`https://nextdoor.com/p/ExamplePost123${EMAIL_QUERY}`,
		`https://www.nextdoor.co.uk/p/ExamplePost123${EMAIL_QUERY}`,
		`https://example.com/p/ExamplePost123${EMAIL_QUERY}`,
	])("leaves %s as it is", (url) => {
		assert.equal(toNextdoorPostUrl(url), url);
	});
});
