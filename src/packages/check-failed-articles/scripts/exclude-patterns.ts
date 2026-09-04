/**
 * URLs matching any of these regexes are operator-driven excludes — the canary
 * will not list them even when their crawl/summary axis is in a terminal
 * unsuccessful state. Add an entry only for a class of URL the operator has
 * already decided is "known broken / not worth investigating again" (e.g., a
 * site that requires authentication, a content type the product doesn't
 * support, a stale customer asset that will never resolve).
 *
 * Each entry is matched against the row's `originalUrl` (or `url` for legacy
 * rows without `originalUrl`). The match is a regex test, so a single entry
 * can cover a whole domain or path prefix.
 *
 * Adding a real, fixable failure URL here silently hides the regression — be
 * intentional, and prefer fixing the underlying crawler/summary path first.
 */
export const EXCLUDE_PATTERNS: readonly RegExp[] = [
	// example.com — any subdomain, any path, with or without scheme. Used as
	// fixture data by save-link E2E suites and Pulumi smoke tests, so it
	// produces a large recurring backlog of crawl-failed rows that the
	// operator never actually needs to re-save.
	/(?:^|\/\/)(?:[a-z0-9-]+\.)*example\.com(?:[/:?#]|$)/i,
	// Internal/private-network hostnames — these have no public DNS resolution
	// so the crawler can never succeed. Requires at least one label before the
	// suffix so bare suffixes (which can't be real hostnames) still surface as
	// failures.
	/(?:^|\/\/)(?:[a-z0-9-]+\.)+(?:local|lan|internal|home\.arpa)(?:[/:?#]|$)/i,
	// Singleton local hostnames, same rationale as the suffix entry above.
	/(?:^|\/\/)(?:localhost|ip6-localhost|ip6-loopback)(?:[/:?#]|$)/i,
	// `nhttps:/…` or `nhttps://…` — a real but typo'd scheme that appears
	// in legacy rows (someone fat-fingered the address bar / clipboard).
	// Storage holds both one- and two-slash variants because URL
	// normalization upstream sometimes collapses `//` to `/`. The fetcher
	// always fails either way; there's nothing to crawl. The whole URL is
	// unusable, not just unreachable, so an operator re-save is the only
	// resolution.
	/^nhttps:\/{1,2}/i,
	// Quote-wrapped absolute URLs resolved as relative paths
	// (`…/%22https:/…`) — link-extraction artifacts where a client kept the
	// quotes around a malformed href and resolved it against the page origin.
	// No real page exists behind such a path, so the crawl
	// deterministically 404s and recrawl can never succeed. Anchored to the
	// path portion ([^?#]*) so a quoted URL inside a query string — where the
	// underlying page may still be crawlable — does not match. Matches both
	// the collapsed (`https:/`) and uncollapsed (`https://`) embedded scheme,
	// with or without a stored scheme prefix (legacy rows are schemeless).
	/^(?:https?:\/\/)?[^?#]*\/%22https?:\//i,
	// Browser-internal schemes (`chrome://`, `about:`, etc.) — legacy rows
	// saved before `validateSaveableUrl` added the `unsupported_scheme`
	// rejection. The crawler can never fetch these; intake now blocks them.
	/^chrome:\/\//i,
	/^about:/i,
	// Git smart-HTTP probes, minted by an anonymous `/view` first visit rather
	// than by anyone saving them (issue #1073): pointing `git` at a
	// `/view/<github-url>` link makes it append `/info/refs`, which the splat
	// route materialises as an article. GitHub answers dumb-http with a
	// deterministic 403 from every IP, so a recrawl can never drain it, and each
	// attempt spends metered proxy egress on the refusal. Anchored to the
	// owner/repo shape so real repo pages still surface; the trailing group
	// tolerates `?service=git-upload-pack`.
	/^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/]+\/[^/]+\/info\/refs(?:[?#]|$)/i,
	// Reddit, narrowed to the shapes the proxied crawl still cannot reach.
	// `www.reddit.com/r/<sub>/comments/…` now resolves, so it is deliberately
	// no longer excluded — a failure there is a regression worth surfacing.
	// These two still return a stub rather than the post the share link points
	// at, so they stay noise the operator cannot act on.
	/(?:^|\/\/)(?:[a-z0-9-]+\.)*reddit\.com\/user\//i,
	/(?:^|\/\/)(?:[a-z0-9-]+\.)*reddit\.com\/r\/[^/]+\/s\//i,
	/(?:^|\/\/)(?:[a-z0-9-]+\.)*onlinelibrary\.wiley\.com(?:[/:?#]|$)/i,
	// Time-limited presigned URLs — permanently dead once the signature lapses.
	// TTLs are minutes, so the crawl fetch lands at or after expiry and the
	// origin answers 403 for the object from then on; recrawl re-fetches the
	// exact stored URL, so it can never succeed and the row is never operator-
	// actionable. Matched by shape: every signature param must appear as a whole
	// query-param name, in any order, before any fragment. A presign still valid
	// at fetch time is excluded too — deliberately: it has lapsed long before the
	// operator reads the report, so it is equally unactionable.
	//
	// S3 SigV2 query auth (`AWSAccessKeyId` + `Signature` + `Expires=<epoch>`;
	// STS variants add `x-amz-security-token` but always carry these three).
	/^[^#?]*(?=\?)(?=[^#]*[?&]AWSAccessKeyId=)(?=[^#]*[?&]Signature=)(?=[^#]*[?&]Expires=\d)/i,
	// S3 SigV4 query auth (`X-Amz-Signature` + `X-Amz-Expires=<seconds>`).
	/^[^#?]*(?=\?)(?=[^#]*[?&]X-Amz-Signature=)(?=[^#]*[?&]X-Amz-Expires=\d)/i,
	// CloudFront canned-policy signed URLs (`Key-Pair-Id` + `Signature` +
	// `Expires=<epoch>`).
	/^[^#?]*(?=\?)(?=[^#]*[?&]Key-Pair-Id=)(?=[^#]*[?&]Signature=)(?=[^#]*[?&]Expires=\d)/i,
	// Operator-curated exact-URL excludes — individual rows the operator has
	// decided are "known broken / not worth investigating again". Each entry
	// is anchored with `^…$` so it matches only the exact stored URL, not a
	// whole host or path prefix.
	/^fabiensanglard\.net\/quake$/i,
	// Tolerates up to four trailing `.` — the stored row literally ends in
	// `....` (display truncation that leaked into the saved URL).
	/^https:\/\/www\.theinformation\.{0,4}$/i,
	/^https:\/\/web\.eecs\.umich\.edu\/~weimerw\/2018-481\/readings\/mythical-man-month\.pdf$/i,
	// Substack `legacy-no-content` rows — content was never persisted under
	// these exact tracking-suffixed URLs and the originals are gated behind
	// a paid newsletter.
	/^https:\/\/cutlefish\.substack\.com\/p\/tbm-1352-asking-better-questions\?utm_source=substack&utm_medium=email$/i,
	/^https:\/\/cutlefish\.substack\.com\/p\/tbm-410-dancing-with-problems\?utm_source=post-email-title&publication_id=24711&post_id=190590408&utm_campaign=email-post-title&isFreemail=true&r=5ik6xc&triedRedirect=true&utm_medium=email$/i,
	/^https:\/\/psychologywod\.com\/2013\/08\/18\/blocked-practice-vs-random-practice-shake-things-up-in-your-training-and-in-your-life\/$/i,
	// Akamai BotManager RSTs HTTP/2 from AWS-range IPs at the TLS layer —
	// both `default-browser` and `honest-bot` personas fail. Requires a
	// non-AWS egress path (residential proxy) to resolve.
	/^https:\/\/www\.rd\.usda\.gov\/sites\/default\/files\/pdf-sample_0\.pdf$/i,
	// PwC HR system returns HTTP 410 Gone on every attempt — job posting was
	// delisted at origin, so recrawl can never succeed.
	/^https:\/\/jobs-au\.pwc\.com\/experiencedhires\/au\/en\/job\/597385WD\/Senior-Manager-Finance-Transformation-Global-Business-Services$/i,
	// Typo domain: `fagnerbracj.com` (should be `fagnerbrack.com`, note
	// `j` vs `k`). DNS returns NXDOMAIN — the domain does not exist and
	// recrawl can never succeed.
	/^https:\/\/fagnerbracj\.com\/learn-python-the-hard-way-was-right-about-one-thing-9b6ab0b67526$/i,
	// Permanently-unreachable saves drained from the worklist: each origin is
	// gone, blocked from datacenter egress, or redirects away from the saved
	// content, so a recrawl can never reproduce the article. Grouped by why the
	// fetch can never land.
	//
	// (a) Origin removed the page — the fetch resolves to a 404. The apex/www
	// pairs were each saved as two rows; the apex form 30x-redirects to the www
	// form, which 404s, so one `(?:www\.)?` entry covers both.
	// `…2019` was saved without a trailing slash; `\/?` covers both shapes.
	/^https:\/\/apisyouwonthate\.com\/blog\/rest-and-hypermedia-in-2019\/?$/i,
	/^https:\/\/(?:www\.)?bocoup\.com\/weblog\/es2015-nightmarefile$/i,
	/^https:\/\/(?:www\.)?braziljs\.org\/conf\/2013$/i,
	/^https:\/\/dannorth\.net\/author\/tastapod\/$/i,
	/^https:\/\/www\.ctl\.io\/developers\/blog\/post\/career-path-of-a-programmer\/$/i,
	// The 1996 Space Jam frameset is mirrored on both spacejam.com and
	// warnerbros.com; neither host serves a readable article body.
	/^https:\/\/www\.(?:spacejam|warnerbros)\.com\/archive\/spacejam\/movie\/jam\.htm$/i,
	/^https:\/\/www\.se\.rit\.edu\/~tabeec\/RIT_441\/Resources_files\/How%20To%20Write%20Unmaintainable%20Code\.pdf$/i,
	// `/request-demo-search/` 301s to the slashless form, which 404s; `\/?`
	// tolerates both saved shapes.
	/^https:\/\/www\.hackerrank\.com\/request-demo-search\/?$/i,
	// Anchored to the trailing-slash + fragment form that was saved; the live
	// doctrine page is the slashless `…/doctrine`, which this must not catch.
	/^https:\/\/rubyonrails\.org\/doctrine\/#optimize-for-programmer-happiness$/i,
	// Medium `/u/<id>` profile stub for a deleted account — 404s, and was never
	// article content even when the account existed.
	/^https:\/\/medium\.com\/u\/8de1791147b8$/i,
	// torvalds/linux has pull requests disabled, so this PR permalink 404s.
	/^https:\/\/github\.com\/torvalds\/linux\/pull\/17#issuecomment-5654674$/i,
	// (b) Domain does not resolve — returns NXDOMAIN.
	/^https:\/\/divshot\.com\/blog\/opinion\/angular-2-crazy-like-a-fox\/$/i,
	// wowwwman.com is undelegated — apex and `www` both answer NXDOMAIN from the
	// local resolver, 1.1.1.1 and 8.8.8.8, with no NS records at all. The row
	// reads `exhausted-retries` rather than a DNS-specific reason because a name
	// that does not resolve produces no response to classify, so the fetch just
	// burns its retries; that is the same dead end as the divshot entry above,
	// not a crawler defect. Anchored to the site root (the saved form was
	// `http://www.wowwwman.com/`; `https?`, `www.` and the trailing slash are
	// optional so a re-save of the same root matches) rather than the whole host,
	// so if the domain is ever registered again its article pages still surface.
	/^https?:\/\/(?:www\.)?wowwwman\.com\/?$/i,
	// (c) Dead hosting platform — java.net was retired; the host serves a
	// terminal 503.
	/^https:\/\/jstl\.java\.net\/$/i,
	// (d) Redirects away from the saved content — the article is gone and the
	// 30x lands on a section index or site root, so a recrawl would capture the
	// wrong page. fastcodesign.com folded into fastcompany.com's co-design
	// section; the Scratch help page moved to scratch-wiki.info's root;
	// mindsetworks `/index.html` is a bare redirect stub.
	/^https:\/\/www\.fastcodesign\.com\/3062292\/evidence\/brainstorming-is-dumb$/i,
	/^https:\/\/wiki\.scratch\.mit\.edu\/wiki\/Help:Hard_Refresh$/i,
	/^https:\/\/mindsetworks\.com\/index\.html$/i,
	// The `/Science/` section pages (saved with both capitalisations) do not
	// resolve — the fetch never lands.
	/^https:\/\/www\.mindsetworks\.com\/[Ss]cience\/$/i,
	// (e) Edge firewall / bot-wall that answers datacenter egress with a
	// challenge or error instead of content (202 JS-challenge, 401 bot-check,
	// 403 edge ACL, 503) — the same residential-egress requirement as the USDA
	// PDF entry above, so the AWS-egress crawler can never resolve them.
	/^https:\/\/(?:www\.)?agilealliance\.org\/glossary\/pairing\/$/i,
	/^https:\/\/unsplash\.com\/@metelevan\?utm_source=medium&utm_medium=referral$/i,
	/^https:\/\/blogs\.oracle\.com\/ravello\/beware-http-requests-automatic-retries$/i,
	/^https:\/\/kernel-recipes\.org\/en\/2016\/talks\/patches-carved-into-stone-tablets\/$/i,
	/^https:\/\/www\.microservices\.com\/talks\/dont-build-a-distributed-monolith\/$/i,
	// Reddit 403s datacenter egress from its own edge. This row failed 21 minutes
	// before the proxied second pass existed, so it records a crawler that no
	// longer runs. Anchored exact: other `/r/<sub>/comments/` URLs must still
	// surface as regressions.
	/^https:\/\/www\.reddit\.com\/r\/programming\/comments\/1vqukkf\/nothing_like_a_monday_morning_github_outage\/$/i,
	// Cloudflare answers this question with a challenge (403) to datacenter and
	// residential egress alike. The row still holds content and a summary from an
	// earlier successful crawl; a recrawl is what made it terminal, so listing it
	// only invites repeating that.
	/^https:\/\/stackoverflow\.com\/questions\/11227809\/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array$/i,
	// (f) Login/subscription wall — the origin serves a registration/login page
	// instead of the article body to anonymous datacenter fetches, so the crawler
	// exhausts retries without ever reaching content. academia.edu requires a free
	// account to view the paper; Oxford Academic gates the QJE full text behind
	// subscription login (the optional `?login=false` suffix is the host's own
	// pre-login redirect shape; the bare URL was saved too).
	/^https:\/\/www\.academia\.edu\/4749776\/Personal_experience_and_the_construction_of_knowledge_in_science$/i,
	// Query-string variant of a CloudFront-hosted academia.edu PDF whose bare
	// path now crawls and holds the paper. This form is edge-blocked, making it
	// a duplicate of a working canonical rather than a missing document, and it
	// carries no signature params so the presign shapes above do not cover it.
	// Anchored to the query form so the bare path still surfaces if it regresses.
	/^https:\/\/d1wqtxts1xzle7\.cloudfront\.net\/49645891\/sce\.373067020820161016-1490-16axao2\.pdf\?/i,
	// itnext.io is a Medium-hosted publication; Medium bot-walls datacenter
	// egress (the same residential-egress requirement as the medium.com and
	// edge-firewall entries above), so the AWS crawler exhausts retries.
	/^https:\/\/itnext\.io\/youre-not-praised-for-the-bugs-you-didn-t-create-ef3df6894d5c$/i,
	// castorama.fr product listing for a Keter garden storage box — an
	// e-commerce product page, not the readable article content the product
	// renders, so the crawl exhausts retries with nothing worth re-saving behind
	// it (same rationale as the npmjs package-listing entry above). The stored
	// row's dimension segment is `…270-l-l-118-x-h-57…` (L 118 cm); `1?18`
	// tolerates the one-digit transcription variant so the exclude holds whether
	// the row reads `l-l-118` or `l-l-18`.
	/^https:\/\/www\.castorama\.fr\/coffre-de-jardin-resine-effet-rotin-tresse-270-l-l-1?18-x-h-57-x-p-45-cm-marron-keter-emily\/7290112634603_CAFR\.prd$/i,
	// Doubled save: the fagnerbrack.com article URL with a scheme-collapsed copy
	// of itself appended to the slug — a paste/link-extraction artifact with no
	// real page behind it, so the crawl exhausts retries. Anchored to the doubled
	// form so the real single article (`…-9aceb0bdee03`) still crawls; `https:\/{1,2}`
	// tolerates the embedded scheme whether normalization left one slash or two.
	/^https:\/\/fagnerbrack\.com\/learn-sql-once-use-it-for-30-years-9aceb0bdee03https:\/{1,2}fagnerbrack\.com\/learn-sql-once-use-it-for-30-years-9aceb0bdee03$/i,
	// (h) Origin returns 404 for the exact saved path — the page never existed or
	// was removed, so a recrawl can never reproduce it. Each URL was surfaced by
	// the failed-articles canary and confirmed 404 at origin. Anchored to the
	// exact saved path (host + path only, no query string was stored) so a
	// working sibling page on the same host still surfaces as a real failure.
	/^https:\/\/www\.infoq\.com\/news\/2008\/08\/manifesto$/i,
	/^https:\/\/www\.slashdata\.co\/post\/global$/i,
	/^https:\/\/www\.developernation\.net\/developer$/i,
	/^https:\/\/simpleflying\.com\/captain$/i,
	/^https:\/\/www\.jetbrains\.com\/lp\/devecosystem$/i,
	// TODAY (Mediacorp) removed this 2013 article: datacenter egress gets a
	// hard 404 at origin and residential curl gets a 403 bot-wall, so no
	// egress path can reproduce the page. `https?` covers the stored `http`
	// row and any future `https` re-save of the same path.
	/^https?:\/\/www\.todayonline\.com\/singapore\/channel-newsasia-opens-bureau-myanmar$/i,
	// Zhihu removed this answer — a browser gets 404 at origin — but Baidu's
	// BLB edge 403s datacenter egress before the origin can answer, so a
	// recrawl can never land the `not-found` classification that would drain
	// the row on its own. Anchored to the exact saved answer URL; other zhihu
	// rows (including the extension-saved `question/undefined` duplicate of
	// this same answer) must still surface.
	/^https:\/\/www\.zhihu\.com\/question\/2058516301257994660\/answer\/2058890698460509303$/i,
	// Malformed extension save under the same host: the question ID never
	// resolved (`question/undefined`) and a truncated text fragment (`...This`)
	// leaked into the path, so no real page exists behind it (issue #962).
	// Anchored exact; the `question/undefined/answer/<id>` duplicate still surfaces.
	/^https:\/\/www\.zhihu\.com\/question\/undefined\/\.\.\.This$/i,
	// (i) web.archive.org captures — archive.org throttles datacenter egress
	// (tarpits/429s AWS-range IPs), so saved captures intermittently exhaust
	// retries with nothing the operator can act on. Anchored per capture
	// timestamp so other snapshots of the same page still surface;
	// `\/{1,2}` tolerates the embedded scheme whether upstream normalization
	// left one slash or two.
	// ABU press-page capture: fetchable on a quiet day (the row has crawled
	// successfully) but exhausts retries whenever wayback throttles, so it
	// recurs as canary noise on bulk imports.
	/^https:\/\/web\.archive\.org\/web\/20180630081250\/https:\/{1,2}www\.abu\.org\.my\/Latest_News-@-CNA_to_launch_satellite_studio_in_Malaysia\.aspx$/i,
	/^https:\/\/news\.ycombinator\.com\/item$/i,
	// Same stored row shape as the `/item` entry above: `/user` with no `id`
	// query is not a profile, so HN has nothing to serve (it answers 429
	// "Sorry." to datacenter egress; `?id=<user>` returns 200). Anchored exact
	// so real profile URLs still surface.
	/^https:\/\/news\.ycombinator\.com\/user$/i,
	// (j) Paths that never existed, minted by an anonymous `/view` first visit
	// rather than by anyone saving them (issue #1066). fagnerbrack.com is Medium
	// on a custom domain and resolves a post only by its trailing 12-hex id, so
	// a bare slug has never been a valid URL there — `business-success` is a
	// prefix of the real `…-luck-not-merit-51deca80bfaf`, which crawls fine.
	// Neither row has an owning user row; both were materialised by an AI
	// crawler dereferencing the literals in `readplace-unwrap-preprocessor.test.ts`,
	// which is public. A recrawl cannot drain them either way: the stored
	// `edge-block` came from a transient Cloudflare 403 on AWS egress, and the
	// origin actually answers 200 with a ~50KB "PAGE NOT FOUND" soft-404 body, so
	// a recrawl that got through would store that page as the article — a worse
	// end state than the failed row. Anchored exact so real posts on the host,
	// and any future genuine block of them, still surface.
	/^https:\/\/fagnerbrack\.com\/x$/i,
	/^https:\/\/fagnerbrack\.com\/business-success$/i,
	// Medium `/null` junk path (cf. fagnerbrack.com/null, issue #1066): the host
	// blog.cloudboost.io no longer resolves, and `/null` was never a real page, so
	// a recrawl can never land. Anchored exact so a genuine post still surfaces.
	/^https:\/\/blog\.cloudboost\.io\/null$/i,
	// (k) Origin unreachable behind its CDN: Cloudflare answers 530 for every
	// request, from datacenter and residential egress alike, so no crawl can
	// land. Stored as `exhausted-retries` because a 530 is neither a block nor a
	// 404, which makes an origin outage read as a crawler defect.
	/^https:\/\/jkm\.dev\/posts\/how-2004-runescape-fit-a-multiplayer-rpg-into-56k-dialup\/$/i,
];

export function isExcluded(url: string, patterns: readonly RegExp[]): boolean {
	for (const pattern of patterns) {
		if (pattern.test(url)) return true;
	}
	return false;
}
