import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { switchHelpers } from "../../handlebars-switch";
import { renderFoundingProgress } from "../../shared/founding-progress/founding-progress.component";
import type { FoundingAllocation } from "../../shared/founding-progress/founding-allocation";
import { HOME_PAGE_STYLES } from "./home.styles";

const HOME_TEMPLATE = readFileSync(join(__dirname, "home.template.html"), "utf-8");

const HOME_HEADLINE_SCRIPT = `<script>
(function () {
  var rotator = document.querySelector('.hero-headline__rotator');
  if (!rotator) return;
  var words = ['articles', 'news', 'blogs', 'stories', 'newsletters', 'posts', 'reports', 'interviews', 'essays', 'longreads'];
  function makeSpan(cls, text) {
    var el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }
  rotator.textContent = '';
  var sizer = makeSpan('hero-headline__sizer', words[0]);
  var measurer = makeSpan('hero-headline__measurer', '');
  var slots = [
    makeSpan('hero-headline__word hero-headline__word--visible', words[0]),
    makeSpan('hero-headline__word', '')
  ];
  rotator.appendChild(sizer);
  rotator.appendChild(measurer);
  rotator.appendChild(slots[0]);
  rotator.appendChild(slots[1]);
  rotator.classList.add('hero-headline__rotator--enhanced');
  function measure(text) {
    measurer.textContent = text;
    return measurer.offsetWidth;
  }
  rotator.style.width = measure(words[0]) + 'px';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var index = 0;
  var current = 0;
  var scheduled = null;
  var inTick = false;
  function tick() {
    scheduled = null;
    inTick = true;
    var nextIndex = (index + 1) % words.length;
    var next = 1 - current;
    slots[next].textContent = words[nextIndex];
    rotator.style.width = measure(words[nextIndex]) + 'px';
    slots[current].classList.remove('hero-headline__word--visible');
    slots[current].classList.add('hero-headline__word--leaving');
    setTimeout(function () {
      slots[next].classList.add('hero-headline__word--visible');
    }, 150);
    setTimeout(function () {
      slots[current].classList.remove('hero-headline__word--leaving');
      current = next;
      index = nextIndex;
      inTick = false;
      schedule();
    }, 700);
  }
  function schedule() {
    scheduled = setTimeout(tick, 2500);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (scheduled) {
        clearTimeout(scheduled);
        scheduled = null;
      }
    } else if (!scheduled && !inTick) {
      schedule();
    }
  });
  schedule();
})();
</script>`;

const HOME_SCROLL_HINT_SCRIPT = `<script>
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var hint = document.querySelector('.home-try__scroll-hint');
  var header = document.querySelector('.header');
  hint.addEventListener('click', function (e) {
    e.preventDefault();
    var target = document.getElementById(hint.getAttribute('href').slice(1));
    var navOffset = header.getBoundingClientRect().height + parseFloat(getComputedStyle(header).top);
    var startY = window.pageYOffset;
    var endY = target.getBoundingClientRect().top + startY - navOffset;
    var startTime = performance.now();
    requestAnimationFrame(function step(now) {
      var t = Math.min((now - startTime) / 350, 1);
      window.scrollTo(0, startY + (endY - startY) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    });
  });
})();
</script>`;

export function HomePage(params: {
	userCount: number;
	staticBaseUrl: string;
	browser: "firefox" | "chrome" | "other";
	foundingAllocation: FoundingAllocation;
}): PageBody {
	const { userCount, staticBaseUrl, browser, foundingAllocation } = params;
	const foundingMemberLimit = foundingAllocation.foundingMemberLimit;
	const foundingProgressHtml = renderFoundingProgress({ userCount, foundingAllocation });
	const foundingAllocationAvailable = !foundingAllocation.isFoundingAllocationExhausted(userCount);
	const pricingGridStateClass = foundingAllocationAvailable
		? "pricing-grid--visible"
		: "pricing-grid--hidden";
	const fallbackStateClass = foundingAllocationAvailable
		? "home-pricing__fallback--hidden"
		: "home-pricing__fallback--visible";
	return {
		seo: {
			title: "Readplace — Read-It-Later App | Save Articles, Read Them Later",
			description:
				"A read-it-later app and Pocket alternative. Save articles with one click, read them later. Privacy-first, built in Australia by the creator of js-cookie.",
			canonicalUrl: "https://readplace.com",
			ogType: "website",
			ogImage: `${staticBaseUrl}/og-image-1200x630.png`,
			ogImageType: "image/png",
			ogImageAlt:
				"Readplace — A read-it-later app and Pocket alternative. Save articles, read them later.",
			twitterImage: `${staticBaseUrl}/twitter-card-1200x600.png`,
				author: "Fayner Brack",
			keywords:
				"read it later, save articles, bookmark manager, reading list, Pocket alternative, Omnivore alternative, browser extension, Firefox extension, Chrome extension, article reader, distraction free reading, AI summaries",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "WebApplication",
					"@id": "https://readplace.com/#app",
					additionalType: "https://schema.org/MobileApplication",
					name: "Readplace",
					alternateName: ["Readplace Read-It-Later App", "Readplace App"],
					url: "https://readplace.com",
					description:
						"A privacy-first read-it-later app and Pocket alternative. Save articles with one click, read them later.",
					applicationCategory: "ProductivityApplication",
					applicationSubCategory: "Read-It-Later",
					operatingSystem: "Web",
					browserRequirements: "Requires Firefox or Chrome for browser extension",
					softwareVersion: "1.0",
					datePublished: "2026-03-01",
					inLanguage: "en",
					isAccessibleForFree: true,
					offers: [
						{
							"@type": "Offer",
							name: "Founding Member",
							price: "0",
							priceCurrency: "USD",
							description: `Free forever for the first ${foundingMemberLimit} founding members`,
							eligibleQuantity: {
								"@type": "QuantitativeValue",
								value: foundingMemberLimit,
							},
						},
						{
							"@type": "Offer",
							name: "Standard",
							price: "3.99",
							priceCurrency: "USD",
							description: "Full access including TL;DR summaries",
						},
					],
					author: {
						"@type": "Person",
						"@id": "https://readplace.com/#founder",
						name: "Fayner Brack",
						url: "https://fagnerbrack.com",
					},
					featureList: [
						"One-click article saving via browser extension for Firefox and Chrome",
						"Distraction-free reader view powered by Readability.js",
						"AI-generated TL;DR summaries for every saved article",
						"Concierge import service — email your Pocket, Instapaper, or Omnivore export file to readplace+migrate@readplace.com and Fayner imports it by hand within 24–48 hours",
						"Auto dark mode following system preference",
						"OAuth 2.0 with PKCE authentication",
						"Data hosted in Sydney, Australia under Australian Privacy Act",
						"No third-party tracking, no ads, no analytics in the app",
						"Full data export available at any time, even after cancellation",
					],
				},
				{
					"@context": "https://schema.org",
					"@type": "Organization",
					"@id": "https://readplace.com/#organization",
					name: "Readplace",
					alternateName: ["Readplace App", "Readplace Read-It-Later"],
					url: "https://readplace.com",
					logo: `${staticBaseUrl}/android-chrome-512x512.png`,
					sameAs: [
						"https://github.com/Readplace/readplace.com",
						"https://chromewebstore.google.com/detail/hutch/klblengmhlfnmjoagchagfcdbpbocgbf",
					],
					founder: {
						"@type": "Person",
						"@id": "https://readplace.com/#founder",
						name: "Fayner Brack",
						url: "https://fagnerbrack.com",
						sameAs: [
							"https://fagnerbrack.com",
							"https://www.linkedin.com/in/fagnerbrack/",
							"https://github.com/fagnerbrack",
							"https://medium.com/@fagnerbrack",
							"https://www.reddit.com/user/fagnerbrack",
						],
						jobTitle: "Founder",
						worksFor: { "@id": "https://readplace.com/#organization" },
						knowsAbout: [
							"JavaScript",
							"browser extensions",
							"read-it-later applications",
							"web performance",
							"open source maintenance",
						],
						description:
							"Software engineer and creator of js-cookie, a JavaScript library with 22 billion+ annual downloads on jsDelivr CDN. Founder of Readplace.",
						award: "Creator of js-cookie — 22 billion+ annual downloads on jsDelivr CDN",
					},
					description:
						"Readplace is a privacy-first read-it-later app and Pocket alternative.",
					foundingDate: "2025",
					areaServed: "Worldwide",
					address: {
						"@type": "PostalAddress",
						addressCountry: "AU",
						addressRegion: "Victoria",
					},
				},
				{
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: [
						{
							"@type": "Question",
							name: "What is Readplace?",
							acceptedAnswer: {
								"@type": "Answer",
								text: "Readplace is a read-it-later app built from a 10-year personal reading system. Save articles with one click using the browser extension for Firefox or Chrome, read them in a clean reader view, and get TL;DR summaries for every article.",
							},
						},
						{
							"@type": "Question",
							name: "Is Readplace free?",
							acceptedAnswer: {
								"@type": "Answer",
								text: `The first ${foundingMemberLimit} founding members get full access free, forever. After that, $3.99/month — includes TL;DR summaries.`,
							},
						},
						{
							"@type": "Question",
							name: "What happened to Pocket and Omnivore?",
							acceptedAnswer: {
								"@type": "Answer",
								text: "Pocket was acquired by Mozilla and shut down on July 8, 2025. Omnivore was acqui-hired by ElevenLabs and shut down in November 2024. Readplace was built as a reliable alternative, with an 'Even If You Cancel' promise — your data is always exportable.",
							},
						},
						{
							"@type": "Question",
							name: "What features does Readplace have?",
							acceptedAnswer: {
								"@type": "Answer",
								text: "Readplace offers browser extensions for Firefox and Chrome, a web app for managing saved articles, a distraction-free reader view, TL;DR summaries, dark mode, and secure OAuth with PKCE. Planned features include personalised AI summaries, preference learning, Gmail integration, and highlights and notes.",
							},
						},
					],
				},
				{
					"@context": "https://schema.org",
					"@type": "WebSite",
					name: "Readplace — Read-It-Later App",
					alternateName: "Readplace App",
					url: "https://readplace.com",
					description: "A privacy-first read-it-later app.",
				},
			],
		},
		styles: HOME_PAGE_STYLES,
		scripts: HOME_HEADLINE_SCRIPT + HOME_SCROLL_HINT_SCRIPT,
		bodyClass: "page-home",
		content: { html: render(HOME_TEMPLATE, {
			staticBaseUrl,
			browserName: browser,
			founderAvatarUrl: `${staticBaseUrl}/fayner-brack.jpg`,
			foundingProgressHtml,
			foundingMemberLimit,
			foundingAllocationAvailable,
			pricingGridStateClass,
			fallbackStateClass,
			featuredFeatures: [
				{
					name: "Reader View",
					description:
						"Clean article view powered by Mozilla Firefox's Readability engine — the same library Firefox uses. No ads, no sidebars, no pop-ups.",
				},
				{
					name: "Browser Extensions",
					description:
						"Save any page with one click, Ctrl/Cmd+D, or right-click. The extension captures the full rendered page — picking the most complete version of the content over what a URL-only crawl would see. Available for Firefox and Chrome.",
				},
				{
					name: "TL;DR Summaries",
					description:
						"Every saved article gets a TL;DR outlining the most important points. Built on the same AI that powers the reading experience.",
				},
			],
			compactFeatures: [
				{
					name: "Public Reader View",
					description:
						"Paste any link to read or share it — no account, no signup.",
				},
				{
					name: "Mobile Web",
					description:
						"Works in any mobile browser. No app store, no native install.",
				},
				{
					name: "Web App",
					description:
						"Manage and organise your reading list from any browser.",
				},
				{
					name: "Links Import",
					description:
						"Upload bookmarks, notes, newsletters — any text-shaped export — and Readplace pulls every URL out for you to review before saving.",
				},
				{
					name: "PDF Extraction",
					description:
						"Save any PDF link. Vision OCR turns it into a clean, readable article with a TL;DR — scanned pages included.",
				},
				{
					name: "Auto Dark Mode",
					description:
						"Follows your system preference automatically.",
				},
				{
					name: "Secure Auth",
					description:
						"OAuth with PKCE. Tokens stored locally in your browser.",
				},
				{
					name: "Self-Updating Extension",
					description:
						"No browser store dependency. The extension updates itself.",
				},
				{
					name: "Privacy First",
					description:
						"Hosted in Sydney. Australian Privacy Act compliant. No tracking, no ads.",
				}
			],
			plannedFeatures: [
				{
					name: "Preference Learning",
					description:
						"Resurface previously saved articles that match what's interesting to you. You can change your preferences over time.",
				},
				{
					name: "Highlights & Notes",
					description:
						"Highlight passages and add notes as you read to help learning usingthe science of Blocked Practice.",
				},
			],
			trustItems: [
				{
					name: "\"Even If You Cancel\" Promise",
					description:
						"Export everything, anytime. Your data is yours. Cancel and your saved articles stay available for export.",
				},
			],
		}, { helpers: switchHelpers }) },
	};
}
