import { describeUntrackedCtas, findUntrackedCtas } from "./cta-tracking";

const NO_SKIPS = { skipSelectors: [] };

describe("findUntrackedCtas", () => {
	it("reports a same-origin link with no utm_source", () => {
		const found = findUntrackedCtas('<a href="/install">Install</a>', NO_SKIPS);

		expect(found).toEqual([{ tag: "a", method: "GET", target: "/install", label: "Install" }]);
	});

	it("accepts a same-origin link whose query carries utm_source", () => {
		const found = findUntrackedCtas(
			'<a href="/install?utm_source=queue&utm_medium=internal&utm_content=install">Install</a>',
			NO_SKIPS,
		);

		expect(found).toEqual([]);
	});

	it("reports a link whose utm_source is present but empty", () => {
		const found = findUntrackedCtas('<a href="/install?utm_source=">Install</a>', NO_SKIPS);

		expect(found).toEqual([{ tag: "a", method: "GET", target: "/install?utm_source=", label: "Install" }]);
	});

	it("leaves absolute and protocol-relative destinations alone — the click lands on someone else's server", () => {
		const found = findUntrackedCtas(
			'<a href="https://apps.apple.com/app">App Store</a><a href="//cdn.example.com/x">CDN</a><a href="mailto:hi@readplace.com">Email</a><a href="readplace://reader/close">Close</a>',
			NO_SKIPS,
		);

		expect(found).toEqual([]);
	});

	it("requires a GET form to carry the UTM as hidden inputs, because the submit replaces the action's query", () => {
		const found = findUntrackedCtas(
			'<form method="GET" action="/install?utm_source=onboarding"><button>Install</button></form>',
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "form", method: "GET", target: "/install?utm_source=onboarding", label: "Install" },
		]);
	});

	it("accepts a GET form whose hidden inputs carry the UTM", () => {
		const found = findUntrackedCtas(
			'<form method="GET" action="/install"><input type="hidden" name="utm_source" value="onboarding"><button>Install</button></form>',
			NO_SKIPS,
		);

		expect(found).toEqual([]);
	});

	it("reports a GET form whose hidden utm_source is empty", () => {
		const found = findUntrackedCtas(
			'<form method="GET" action="/install"><input type="hidden" name="utm_source" value=""><button>Install</button></form>',
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "form", method: "GET", target: "/install", label: "Install" },
		]);
	});

	it("requires a POST form to carry the UTM on the action, because its fields land in the body the analytics never reads", () => {
		const found = findUntrackedCtas(
			'<form method="post" action="/queue/queues"><input type="hidden" name="utm_source" value="queue-nav"><button>New readlist</button></form>',
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "form", method: "POST", target: "/queue/queues", label: "New readlist" },
		]);
	});

	it("treats a form with no method attribute as the GET it defaults to", () => {
		const found = findUntrackedCtas(
			'<form action="/queue?utm_source=queue"><button>Search</button></form>',
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "form", method: "GET", target: "/queue?utm_source=queue", label: "Search" },
		]);
	});

	it("accepts a POST form whose action query carries the UTM", () => {
		const found = findUntrackedCtas(
			'<form method="POST" action="/queue/queues?utm_source=queue-nav&utm_content=new-readlist"><button>New readlist</button></form>',
			NO_SKIPS,
		);

		expect(found).toEqual([]);
	});

	it("skips everything inside a region the caller nominated as content rather than CTAs", () => {
		const found = findUntrackedCtas(
			'<div class="post"><a href="/blog/other">Another post</a></div><a href="/signup">Sign up</a>',
			{ skipSelectors: [".post"] },
		);

		expect(found).toEqual([{ tag: "a", method: "GET", target: "/signup", label: "Sign up" }]);
	});

	it("falls back to the aria-label when the CTA has no text of its own", () => {
		const found = findUntrackedCtas(
			'<a href="/account" aria-label="Your account"><svg></svg></a>',
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "a", method: "GET", target: "/account", label: "Your account" },
		]);
	});

	it("reports an empty label when the CTA carries neither text nor an aria-label", () => {
		const found = findUntrackedCtas('<a href="/account"><svg></svg></a>', NO_SKIPS);

		expect(found).toEqual([{ tag: "a", method: "GET", target: "/account", label: "" }]);
	});

	it("truncates a long label so one verbose CTA cannot swamp the report", () => {
		const label = "Fetch links Readplace will load the page and pull out every article link it finds";
		const found = findUntrackedCtas(`<a href="/import">${label}</a>`, NO_SKIPS);

		expect(found[0].label).toBe(label.slice(0, 60));
	});
});

describe("describeUntrackedCtas", () => {
	it("renders one line per finding so a failing assertion names the offender", () => {
		const lines = describeUntrackedCtas([
			{ tag: "form", method: "POST", target: "/queue/queues", label: "New readlist" },
		]);

		expect(lines).toEqual(["form POST /queue/queues — New readlist"]);
	});
});
