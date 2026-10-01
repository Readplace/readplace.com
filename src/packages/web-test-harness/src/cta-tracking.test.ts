import { BACKGROUND_REQUEST_ATTRIBUTE, describeUntrackedCtas, findUntrackedCtas } from "./cta-tracking";

const OWN_ORIGIN = "https://readplace.com";
const NO_SKIPS = { skipSelectors: [], ownOrigin: OWN_ORIGIN };
const TAGGED = "utm_source=queue&utm_medium=internal&utm_content=install";
const HIDDEN_MARKERS =
	'<input type="hidden" name="utm_source" value="onboarding"><input type="hidden" name="utm_medium" value="internal"><input type="hidden" name="utm_content" value="install">';

describe("findUntrackedCtas", () => {
	it("reports a same-origin link with no utm_source", () => {
		const found = findUntrackedCtas('<a href="/install">Install</a>', NO_SKIPS);

		expect(found).toEqual([{ tag: "a", method: "GET", target: "/install", label: "Install", problem: "untracked" }]);
	});

	it("accepts a same-origin link whose query carries all three internal-click markers", () => {
		const found = findUntrackedCtas(`<a href="/install?${TAGGED}">Install</a>`, NO_SKIPS);

		expect(found).toEqual([]);
	});

	it("reports a link whose utm_source is present but empty", () => {
		const found = findUntrackedCtas(
			'<a href="/install?utm_source=&utm_medium=internal&utm_content=install">Install</a>',
			NO_SKIPS,
		);

		expect(found).toHaveLength(1);
	});

	it("reports a link whose medium is not internal, because the analytics only counts internal clicks", () => {
		const found = findUntrackedCtas(
			'<a href="/install?utm_source=banner&utm_medium=banner&utm_content=cta">Install</a>',
			NO_SKIPS,
		);

		expect(found).toEqual([
			{
				tag: "a",
				method: "GET",
				target: "/install?utm_source=banner&utm_medium=banner&utm_content=cta",
				label: "Install",
				problem: "untracked",
			},
		]);
	});

	it("reports a link with no utm_content, because two CTAs on one surface could not be told apart", () => {
		const found = findUntrackedCtas(
			'<a href="/install?utm_source=queue&utm_medium=internal">Install</a><a href="/install?utm_source=queue&utm_medium=internal&utm_content=">Again</a>',
			NO_SKIPS,
		);

		expect(found.map((cta) => cta.label)).toEqual(["Install", "Again"]);
	});

	it("checks an absolute link to the app's own origin like a root-relative one", () => {
		const found = findUntrackedCtas(
			`<a href="https://readplace.com/install">Install</a><a href="https://readplace.com/signup?${TAGGED}">Sign up</a>`,
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "a", method: "GET", target: "https://readplace.com/install", label: "Install", problem: "untracked" },
		]);
	});

	it("leaves other origins and non-http destinations alone — the click lands on someone else's server", () => {
		const found = findUntrackedCtas(
			'<a href="https://apps.apple.com/app">App Store</a><a href="https://staging.readplace.com/install">Staging</a><a href="//cdn.example.com/x">CDN</a><a href="mailto:hi@readplace.com">Email</a><a href="readplace://reader/close">Close</a><a href="#top">Top</a><a href="not a url">Odd</a>',
			NO_SKIPS,
		);

		expect(found).toEqual([]);
	});

	it("requires a GET form to carry the markers as hidden inputs, because the submit replaces the action's query", () => {
		const found = findUntrackedCtas(
			`<form method="GET" action="/install?${TAGGED}"><button>Install</button></form>`,
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "form", method: "GET", target: `/install?${TAGGED}`, label: "Install", problem: "untracked" },
		]);
	});

	it("accepts a GET form whose hidden inputs carry all three markers", () => {
		const found = findUntrackedCtas(
			`<form method="GET" action="/install">${HIDDEN_MARKERS}<button>Install</button></form>`,
			NO_SKIPS,
		);

		expect(found).toEqual([]);
	});

	it("reports a GET form whose hidden inputs omit utm_medium", () => {
		const found = findUntrackedCtas(
			'<form method="GET" action="/install"><input type="hidden" name="utm_source" value="onboarding"><input type="hidden" name="utm_content" value="install"><button>Install</button></form>',
			NO_SKIPS,
		);

		expect(found).toEqual([{ tag: "form", method: "GET", target: "/install", label: "Install", problem: "untracked" }]);
	});

	it("reports a GET form whose hidden utm_source carries no value attribute", () => {
		const found = findUntrackedCtas(
			'<form method="GET" action="/install"><input type="hidden" name="utm_source"><input type="hidden" name="utm_medium" value="internal"><input type="hidden" name="utm_content" value="install"><button>Install</button></form>',
			NO_SKIPS,
		);

		expect(found).toHaveLength(1);
	});

	it("requires a POST form to carry the markers on the action, because its fields land in the body the analytics never reads", () => {
		const found = findUntrackedCtas(
			`<form method="post" action="/queue/queues">${HIDDEN_MARKERS}<button>New readlist</button></form>`,
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "form", method: "POST", target: "/queue/queues", label: "New readlist", problem: "untracked" },
		]);
	});

	it("treats a form with no method attribute as the GET it defaults to", () => {
		const found = findUntrackedCtas(
			`<form action="/queue?${TAGGED}"><button>Search</button></form>`,
			NO_SKIPS,
		);

		expect(found).toEqual([{ tag: "form", method: "GET", target: `/queue?${TAGGED}`, label: "Search", problem: "untracked" }]);
	});

	it("accepts a POST form whose action query carries the markers", () => {
		const found = findUntrackedCtas(
			`<form method="POST" action="/queue/queues?${TAGGED}"><button>New readlist</button></form>`,
			NO_SKIPS,
		);

		expect(found).toEqual([]);
	});

	it("checks each button's formaction under its form's POST method, since the button replaces the action", () => {
		const found = findUntrackedCtas(
			`<form method="POST" action="/oauth/authorize?${TAGGED}"><button formaction="/oauth/authorize?${TAGGED}">Approve</button><button formaction="/oauth/authorize">Deny</button></form>`,
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "formaction", method: "POST", target: "/oauth/authorize", label: "Deny", problem: "untracked" },
		]);
	});

	it("lets a button's formmethod override its form's method", () => {
		const found = findUntrackedCtas(
			`<form method="POST" action="/a?${TAGGED}">${HIDDEN_MARKERS}<button formaction="/b" formmethod="get">Go</button><button formaction="/c" formmethod="post">Send</button></form>`,
			NO_SKIPS,
		);

		expect(found).toEqual([{ tag: "formaction", method: "POST", target: "/c", label: "Send", problem: "untracked" }]);
	});

	it("requires a GET formaction to inherit the markers from its form's hidden inputs", () => {
		const found = findUntrackedCtas(
			`<form action="/b">${HIDDEN_MARKERS}<button formaction="/b">Tracked</button></form><form action="/c"><button formaction="/d">Bare</button></form>`,
			NO_SKIPS,
		);

		expect(describeUntrackedCtas(found)).toEqual(["untracked: form GET /c — Bare", "untracked: formaction GET /d — Bare"]);
	});

	it("reports a formaction button outside any form as an untracked GET", () => {
		const found = findUntrackedCtas('<button formaction="/orphan">Orphan</button>', NO_SKIPS);

		expect(found).toEqual([{ tag: "formaction", method: "GET", target: "/orphan", label: "Orphan", problem: "untracked" }]);
	});

	it("checks htmx hx-get and hx-post targets on their own query", () => {
		const found = findUntrackedCtas(
			`<button hx-get="/more?${TAGGED}">More</button><button hx-get="/more">Bare more</button><button hx-post="/save?utm_source=queue&utm_medium=internal&utm_content=save">Save</button><button hx-post="/save">Bare save</button>`,
			NO_SKIPS,
		);

		expect(describeUntrackedCtas(found)).toEqual(["untracked: hx-get GET /more — Bare more", "untracked: hx-post POST /save — Bare save"]);
	});

	it("accepts an hx-get form whose hidden inputs carry the markers, because htmx sends a GET form's fields on the query", () => {
		const found = findUntrackedCtas(
			`<form action="/search" hx-get="/search/results">${HIDDEN_MARKERS}<button>Search</button></form><form action="/find" hx-get="/find/results"><button>Find</button></form>`,
			NO_SKIPS,
		);

		expect(describeUntrackedCtas(found)).toEqual(["untracked: form GET /find — Find", "untracked: hx-get GET /find/results — Find"]);
	});

	it(`skips a request the page fires on its own, marked with ${BACKGROUND_REQUEST_ATTRIBUTE}, so a poll is never counted as a click`, () => {
		const found = findUntrackedCtas(
			`<div hx-get="/poll" hx-trigger="every 2s" ${BACKGROUND_REQUEST_ATTRIBUTE}></div><div hx-post="/load" hx-trigger="load" ${BACKGROUND_REQUEST_ATTRIBUTE}><a href="/inside">Inside</a></div>`,
			NO_SKIPS,
		);

		expect(found).toEqual([{ tag: "a", method: "GET", target: "/inside", label: "Inside", problem: "untracked" }]);
	});

	it.each(["load", "every 3s", "revealed", "intersect once", "submit, load delay:1s"])(
		`reports a request that fires on its own (hx-trigger="%s") but lacks ${BACKGROUND_REQUEST_ATTRIBUTE}, even when tagged, because each firing would count as a click`,
		(trigger) => {
			const found = findUntrackedCtas(`<div hx-get="/poll?${TAGGED}" hx-trigger="${trigger}"></div>`, NO_SKIPS);

			expect(describeUntrackedCtas(found)).toEqual([`auto-fired-unmarked: hx-get GET /poll?${TAGGED} — `]);
		},
	);

	it("still requires markers on a request that waits for the reader", () => {
		const found = findUntrackedCtas('<button hx-post="/save" hx-trigger="click">Save</button>', NO_SKIPS);

		expect(describeUntrackedCtas(found)).toEqual(["untracked: hx-post POST /save — Save"]);
	});

	it(`reports a ${BACKGROUND_REQUEST_ATTRIBUTE} request whose target carries any utm marker, because the analytics would count it as a click`, () => {
		const found = findUntrackedCtas(
			`<div hx-get="/poll?${TAGGED}" hx-trigger="every 3s" ${BACKGROUND_REQUEST_ATTRIBUTE}></div><span hx-get="/check?utm_source=form" hx-trigger="input" ${BACKGROUND_REQUEST_ATTRIBUTE}></span>`,
			NO_SKIPS,
		);

		expect(describeUntrackedCtas(found)).toEqual([
			`background-tagged: hx-get GET /poll?${TAGGED} — `,
			"background-tagged: hx-get GET /check?utm_source=form — ",
		]);
	});

	it("reports CTAs that share a utm_source and utm_content but lead to different destinations, because their clicks could not be told apart", () => {
		const found = findUntrackedCtas(
			`<a href="/install?${TAGGED}">Install</a><form method="POST" action="/signup?${TAGGED}"><button>Sign up</button></form><a href="/install?client=iphone&${TAGGED}">iPhone</a><a href="/import?utm_source=other&utm_medium=internal&utm_content=install">Import</a>`,
			NO_SKIPS,
		);

		expect(describeUntrackedCtas(found)).toEqual([
			`shared-content: a GET /install?${TAGGED} — Install`,
			`shared-content: a GET /install?client=iphone&${TAGGED} — iPhone`,
			`shared-content: form POST /signup?${TAGGED} — Sign up`,
		]);
	});

	it("lets CTAs share a utm_content when they lead to the same destination, or to the same route for different items", () => {
		const found = findUntrackedCtas(
			`<a href="/install?${TAGGED}">Top</a><a href="https://readplace.com/install?${TAGGED}">Bottom</a><a href="/inbox/m-1?utm_source=inbox&utm_medium=internal&utm_content=open-email">One</a><a href="/inbox/2026%3Am-2?utm_source=inbox&utm_medium=internal&utm_content=open-email">Two</a><a href="/inbox?cursor=a1&utm_source=inbox&utm_medium=internal&utm_content=older">Older</a><a href="/inbox?cursor=b2&utm_source=inbox&utm_medium=internal&utm_content=older">Older again</a>`,
			NO_SKIPS,
		);

		expect(found).toEqual([]);
	});

	it("skips everything inside a region the caller nominated as content rather than CTAs", () => {
		const found = findUntrackedCtas(
			'<div class="post"><a href="/blog/other">Another post</a></div><a href="/signup">Sign up</a>',
			{ skipSelectors: [".post"], ownOrigin: OWN_ORIGIN },
		);

		expect(found).toEqual([{ tag: "a", method: "GET", target: "/signup", label: "Sign up", problem: "untracked" }]);
	});

	it("falls back to the aria-label when the CTA has no text of its own", () => {
		const found = findUntrackedCtas(
			'<a href="/account" aria-label="Your account"><svg></svg></a>',
			NO_SKIPS,
		);

		expect(found).toEqual([
			{ tag: "a", method: "GET", target: "/account", label: "Your account", problem: "untracked" },
		]);
	});

	it("reports an empty label when the CTA carries neither text nor an aria-label", () => {
		const found = findUntrackedCtas('<a href="/account"><svg></svg></a>', NO_SKIPS);

		expect(found).toEqual([{ tag: "a", method: "GET", target: "/account", label: "", problem: "untracked" }]);
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
			{ tag: "form", method: "POST", target: "/queue/queues", label: "New readlist", problem: "untracked" },
		]);

		expect(lines).toEqual(["untracked: form POST /queue/queues — New readlist"]);
	});
});
