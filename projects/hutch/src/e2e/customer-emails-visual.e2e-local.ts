import assert from "node:assert/strict";
import type { Locator, Page } from "@playwright/test";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { captureCheckpoint, expect, measuredBox, test } from "@packages/e2e-harness";
import { AutomationSavesHeldEmail } from "../runtime/web/auth/automation-saves-held-email";
import { ChargeReminderEmail } from "../runtime/web/auth/charge-reminder-email";
import { GmailNewsletterNoticeEmail } from "../runtime/web/auth/gmail-newsletter-notice-email";
import { InboxFirstArrivalEmail } from "../runtime/web/auth/inbox-first-arrival-email";
import { buildPasswordResetEmailHtml } from "../runtime/web/auth/password-reset-email";
import { PaymentFailedEmail } from "../runtime/web/auth/payment-failed-email";
import { TrialFeedbackEmail } from "../runtime/web/auth/trial-feedback-email";
import { TrialReminderEmail } from "../runtime/web/auth/trial-reminder-email";
import { buildVerificationEmailHtml } from "../runtime/web/auth/verification-email";
import { buildWelcomeEmailHtml } from "../runtime/web/auth/welcome-email";
import { buildUserDataExportEmailHtml } from "../runtime/web/pages/export/user-data-export-email";
import { QueueDigestEmail } from "../runtime/web/queue-digest-email";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { type MeasuredBox, pageOverflowsSideways } from "./page-measurements.browser";

const DESKTOP = { name: "desktop", viewport: { width: 800, height: 900 }, cardPadding: 40 } as const;
const MOBILE = { name: "mobile", viewport: { width: 390, height: 844 }, cardPadding: 24 } as const;

const INTER_STYLESHEET = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
const FOUNDER_AVATAR = "https://static.readplace.com/fayner-brack.jpg";

const WHOLE_EMAIL = "body";
const CARD = "body > table > tbody > tr > td > table";
const CARD_BODY = "td.email-card__body";
const CARD_BODY_FIRST_CHILD = `${CARD_BODY} > :first-child`;
const BUTTON = 'td[style*="border-radius:6px;background-color:"] > a[style*="display:inline-block"]';
const CARD_MAX_WIDTH = 480;
const SIDE_PADDING = 20;
const SUBPIXEL = 0.5;

interface CustomerEmail {
	slug: string;
	widths: readonly (typeof DESKTOP | typeof MOBILE)[];
	buttons: number;
	html: () => string;
}

const CUSTOMER_EMAILS: readonly CustomerEmail[] = [
	{
		slug: "email-verification--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () => buildVerificationEmailHtml("https://readplace.com/verify-email?token=669d1635354998dd40ca4c8bd8c60adefe77a7d759cb67d8ee85f8ed5978bbca"),
	},
	{
		slug: "welcome--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			buildWelcomeEmailHtml({
				installUrl: "https://readplace.com/install?utm_source=welcome-email&utm_medium=email&utm_campaign=onboarding&utm_content=install",
				avatarUrl: FOUNDER_AVATAR,
			}),
	},
	{
		slug: "password-reset--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () => buildPasswordResetEmailHtml("https://readplace.com/reset-password?token=c6bfc985741f2c645e5927d720c232635628f32acf4c48af5e516f08b000aae6"),
	},
	{
		slug: "trial-ending-digest--pay",
		widths: [DESKTOP, MOBILE],
		buttons: 2,
		html: () =>
			QueueDigestEmail({
				kind: "pay",
				items: [
					{
						articleId: ReaderArticleHashIdSchema.parse("64acf0bec2cd58997ef1973657b7e2fc"),
						title: "Some terminal frustrations",
						siteName: "Julia Evans",
						preview: "1,600 terminal users shared what trips them up, from copy and paste to remembering syntax.",
					},
					{
						articleId: ReaderArticleHashIdSchema.parse("2ce5d05895df09a78f6f40b284524b05"),
						title: "Patterns of Distributed Systems",
						siteName: "martinfowler.com",
						preview: "The patterns Kafka, Cassandra and etcd share, from write-ahead logs to leader election.",
					},
					{
						articleId: ReaderArticleHashIdSchema.parse("33f5d5d8997efe2895c14520ac4bf560"),
						title: "Choose Boring Technology",
						siteName: "mcfunley.com",
						preview: "Every team gets about three innovation tokens, so spend them on what makes the product different.",
					},
				],
				links: {
					appOrigin: "https://readplace.com",
					sendId: "7f2c8a91-4be3-4d0a-b6e5-19c3d7a0f4e2",
					unsubscribeToken: "4f9a1c7e2b3d48e6a0c5d9f1e7b2a6c3.db6e0c9463396e7e6143ec80076a062a3ca046dd6838dc5ba87abf7f7af7e7cc",
				},
				pay: {
					trialEndsAt: "2026-10-09T07:31:09.482Z",
				},
			}).to("text/html"),
	},
	{
		slug: "trial-reminder--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			TrialReminderEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				savedArticlesCount: 17,
				ctaUrl: "https://readplace.com/account?utm_source=trial-reminder&utm_medium=email&utm_campaign=trial-preexpiry&utm_content=subscribe",
			}).to("text/html"),
	},
	{
		slug: "trial-reminder--one-saved-article",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			TrialReminderEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				savedArticlesCount: 1,
				ctaUrl: "https://readplace.com/account?utm_source=trial-reminder&utm_medium=email&utm_campaign=trial-preexpiry&utm_content=subscribe",
			}).to("text/html"),
	},
	{
		slug: "trial-reminder--no-saved-articles",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			TrialReminderEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				savedArticlesCount: 0,
				ctaUrl: "https://readplace.com/account?utm_source=trial-reminder&utm_medium=email&utm_campaign=trial-preexpiry&utm_content=subscribe",
			}).to("text/html"),
	},
	{
		slug: "charge-reminder--yearly",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			ChargeReminderEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				chargeAt: "2026-10-12T09:14:52.318Z",
				ctaUrl: "https://readplace.com/account?utm_source=charge-reminder&utm_medium=email&utm_campaign=trial-precharge&utm_content=manage-subscription",
				plan: "yearly",
			}).to("text/html"),
	},
	{
		slug: "charge-reminder--monthly",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			ChargeReminderEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				chargeAt: "2026-10-13T21:03:11.540Z",
				ctaUrl: "https://readplace.com/account?utm_source=charge-reminder&utm_medium=email&utm_campaign=trial-precharge&utm_content=manage-subscription",
				plan: "monthly",
			}).to("text/html"),
	},
	{
		slug: "charge-reminder--triennial-late-card",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			ChargeReminderEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				chargeAt: "2026-10-08T13:47:29.004Z",
				ctaUrl: "https://readplace.com/account?utm_source=charge-reminder&utm_medium=email&utm_campaign=trial-precharge&utm_content=manage-subscription",
				plan: "triennial",
			}).to("text/html"),
	},
	{
		slug: "charge-reminder--plan-unknown",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			ChargeReminderEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				chargeAt: "2026-10-10T16:22:05.000Z",
				ctaUrl: "https://readplace.com/account?utm_source=charge-reminder&utm_medium=email&utm_campaign=trial-precharge&utm_content=manage-subscription",
			}).to("text/html"),
	},
	{
		slug: "payment-failed--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			PaymentFailedEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				ctaUrl: "https://readplace.com/account?utm_source=payment-failed&utm_medium=email&utm_campaign=dunning&utm_content=update-card",
			}).to("text/html"),
	},
	{
		slug: "trial-feedback--default",
		widths: [DESKTOP, MOBILE],
		buttons: 0,
		html: () =>
			TrialFeedbackEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				savedArticlesCount: 23,
			}).to("text/html"),
	},
	{
		slug: "trial-feedback--one-article",
		widths: [DESKTOP],
		buttons: 0,
		html: () =>
			TrialFeedbackEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				savedArticlesCount: 1,
			}).to("text/html"),
	},
	{
		slug: "trial-feedback--no-articles",
		widths: [DESKTOP],
		buttons: 0,
		html: () =>
			TrialFeedbackEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				savedArticlesCount: 0,
			}).to("text/html"),
	},
	{
		slug: "automation-saves-held--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			AutomationSavesHeldEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				inboxAddress: "inbox-k7m2q9@read.place",
				inboxUrl: "https://readplace.com/inbox?highlight=2026-10-05T11%3A42%3A07.318Z%23%3C20261005114158.3f7c2a91d4e8b605%40tldrnewsletter.com%3E&utm_source=automation-saves-held&utm_medium=email&utm_campaign=lapsed-inbox-save&utm_content=open-inbox",
				reactivateUrl: "https://readplace.com/account?utm_source=automation-saves-held&utm_medium=email&utm_campaign=lapsed-inbox-save&utm_content=reactivate",
				manageAddressesUrl: "https://readplace.com/newsletters/custom-emails?utm_source=automation-saves-held&utm_medium=email&utm_campaign=lapsed-inbox-save&utm_content=manage-addresses",
			}).to("text/html"),
	},
	{
		slug: "automation-saves-held--no-inbox-address",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			AutomationSavesHeldEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				inboxAddress: undefined,
				inboxUrl: "https://readplace.com/inbox?utm_source=automation-saves-held&utm_medium=email&utm_campaign=lapsed-inbox-save&utm_content=open-inbox",
				reactivateUrl: "https://readplace.com/account?utm_source=automation-saves-held&utm_medium=email&utm_campaign=lapsed-inbox-save&utm_content=reactivate",
				manageAddressesUrl: "https://readplace.com/newsletters/custom-emails?utm_source=automation-saves-held&utm_medium=email&utm_campaign=lapsed-inbox-save&utm_content=manage-addresses",
			}).to("text/html"),
	},
	{
		slug: "queue-digest--default",
		widths: [DESKTOP, MOBILE],
		buttons: 2,
		html: () =>
			QueueDigestEmail({
				kind: "regular",
				items: [
					{
						articleId: ReaderArticleHashIdSchema.parse("2ce5d05895df09a78f6f40b284524b05"),
						title: "Patterns of Distributed Systems",
						siteName: "martinfowler.com",
						preview: "The patterns Kafka, Cassandra and etcd share, from write-ahead logs to leader election.",
					},
					{
						articleId: ReaderArticleHashIdSchema.parse("7c368effbdca46a0f52c2efc02478b4c"),
						title: "How to Do Great Work",
						siteName: "paulgraham.com",
						preview: "Pick work you have a natural aptitude for and a deep interest in, then push to the edge of it.",
					},
					{
						articleId: ReaderArticleHashIdSchema.parse("2b0ed81ce2c63bbc70bc902e58b83fcf"),
						title: "Why the Past 10 Years of American Life Have Been Uniquely Stupid",
						siteName: "The Atlantic",
						preview: "Social media broke the shared stories that held democracy together, and it started around 2009.",
					},
				],
				links: {
					appOrigin: "https://readplace.com",
					sendId: "b6e3f0a2-5c1d-4e7f-9a83-2d4c6e8f1a57",
					unsubscribeToken: "4f9a1c7e2b3d48e6a0c5d9f1e7b2a6c3.db6e0c9463396e7e6143ec80076a062a3ca046dd6838dc5ba87abf7f7af7e7cc",
				},
				markReadToken: "eyJ1c2VySWQiOiI0ZjlhMWM3ZTJiM2Q0OGU2YTBjNWQ5ZjFlN2IyYTZjMyIsImFydGljbGVJZHMiOlsiMmNlNWQwNTg5NWRmMDlhNzhmNmY0MGIyODQ1MjRiMDUiLCI3YzM2OGVmZmJkY2E0NmEwZjUyYzJlZmMwMjQ3OGI0YyIsIjJiMGVkODFjZTJjNjNiYmM3MGJjOTAyZTU4YjgzZmNmIl19.3e29653bc13b1de7cd70048916a139b43e9dd421ff22d71f185b153a1fd0abc8",
			}).to("text/html"),
	},
	{
		slug: "queue-digest--single-article",
		widths: [DESKTOP],
		buttons: 2,
		html: () =>
			QueueDigestEmail({
				kind: "regular",
				items: [
					{
						articleId: ReaderArticleHashIdSchema.parse("ed9d6c5b3b22fb9fe1dbb13021f5368f"),
						title: "The Bitter Lesson",
						siteName: "www.incompleteideas.net",
						preview: "Seventy years of AI research show that general methods which scale with computation beat methods built on human knowledge, and by a large margin. Chess, Go, speech recognition and computer vision…",
					},
				],
				links: {
					appOrigin: "https://readplace.com",
					sendId: "e41a7b39-6d02-4c85-b1f3-7a9e2c5d0b68",
					unsubscribeToken: "4f9a1c7e2b3d48e6a0c5d9f1e7b2a6c3.db6e0c9463396e7e6143ec80076a062a3ca046dd6838dc5ba87abf7f7af7e7cc",
				},
				markReadToken: "eyJ1c2VySWQiOiI0ZjlhMWM3ZTJiM2Q0OGU2YTBjNWQ5ZjFlN2IyYTZjMyIsImFydGljbGVJZHMiOlsiZWQ5ZDZjNWIzYjIyZmI5ZmUxZGJiMTMwMjFmNTM2OGYiXX0.4096df2c23e0f123f29a24baba2b74a0fed46f9a2b155b2940b9c2fab97e25fe",
			}).to("text/html"),
	},
	{
		slug: "inbox-first-arrival--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			InboxFirstArrivalEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				inboxAddress: "inbox-k7m2q9@read.place",
				inboxUrl: "https://readplace.com/inbox?highlight=2026-10-05T07%3A42%3A18.613Z%23%3C20261005074211.3.8f2c4a91d7e6b035%40mg-d1.substack.com%3E&utm_source=first-inbox-email&utm_medium=email&utm_campaign=inbox-first-arrival&utm_content=open-inbox",
			}).to("text/html"),
	},
	{
		slug: "inbox-first-arrival--custom-readlist-alias",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			InboxFirstArrivalEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				inboxAddress: "longreads-p4n8z2@read.place",
				inboxUrl: "https://readplace.com/inbox?highlight=2026-10-05T07%3A42%3A19.204Z%23%3C20261005074211.3.8f2c4a91d7e6b035%40mg-d1.substack.com%3E&utm_source=first-inbox-email&utm_medium=email&utm_campaign=inbox-first-arrival&utm_content=open-inbox",
			}).to("text/html"),
	},
	{
		slug: "gmail-newsletter-notice--named-newsletter",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			GmailNewsletterNoticeEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				newsletters: [
					{
						newsletterName: "JavaScript Weekly",
						senderEmail: "jsw@peterc.org",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=jsw%40peterc.org&notification=1&readlist_choice_for=jsw%40peterc.org&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
				],
				gmailUrl: "https://readplace.com/newsletters/gmail?utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlists",
				waiting: 0,
			}).to("text/html"),
	},
	{
		slug: "gmail-newsletter-notice--unnamed-sender",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			GmailNewsletterNoticeEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				newsletters: [
					{
						newsletterName: undefined,
						senderEmail: "lenny@substack.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=lenny%40substack.com&notification=1&readlist_choice_for=lenny%40substack.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
				],
				gmailUrl: "https://readplace.com/newsletters/gmail?utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlists",
				waiting: 0,
			}).to("text/html"),
	},
	{
		slug: "gmail-newsletter-notice--grouped",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			GmailNewsletterNoticeEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				newsletters: [
					{
						newsletterName: undefined,
						senderEmail: "lenny@substack.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=lenny%40substack.com&notification=1&readlist_choice_for=lenny%40substack.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "Pointer",
						senderEmail: "suraj@pointer.io",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=suraj%40pointer.io&notification=1&readlist_choice_for=suraj%40pointer.io&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "TLDR",
						senderEmail: "dan@tldrnewsletter.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=dan%40tldrnewsletter.com&notification=1&readlist_choice_for=dan%40tldrnewsletter.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
				],
				gmailUrl: "https://readplace.com/newsletters/gmail?utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlists",
				waiting: 0,
			}).to("text/html"),
	},
	{
		slug: "gmail-newsletter-notice--grouped-with-waiting",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			GmailNewsletterNoticeEmail({
				founderAvatarUrl: FOUNDER_AVATAR,
				newsletters: [
					{
						newsletterName: "Business Insider",
						senderEmail: "newsletter.email@businessinsider.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=newsletter.email%40businessinsider.com&notification=1&readlist_choice_for=newsletter.email%40businessinsider.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "Google Alerts",
						senderEmail: "googlealerts-noreply@google.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=googlealerts-noreply%40google.com&notification=1&readlist_choice_for=googlealerts-noreply%40google.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "JavaScript Weekly",
						senderEmail: "jsw@peterc.org",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=jsw%40peterc.org&notification=1&readlist_choice_for=jsw%40peterc.org&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "Leadership in Tech",
						senderEmail: "jakub@mail.leadershipintech.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=jakub%40mail.leadershipintech.com&notification=1&readlist_choice_for=jakub%40mail.leadershipintech.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: undefined,
						senderEmail: "lenny@substack.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=lenny%40substack.com&notification=1&readlist_choice_for=lenny%40substack.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "Manager.dev",
						senderEmail: "anton@newsletter.manager.dev",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=anton%40newsletter.manager.dev&notification=1&readlist_choice_for=anton%40newsletter.manager.dev&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "Pointer",
						senderEmail: "suraj@pointer.io",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=suraj%40pointer.io&notification=1&readlist_choice_for=suraj%40pointer.io&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "Programming Digest",
						senderEmail: "jakub@programmingdigest.net",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=jakub%40programmingdigest.net&notification=1&readlist_choice_for=jakub%40programmingdigest.net&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "Signals from Our Futures Past",
						senderEmail: "mamund@substack.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=mamund%40substack.com&notification=1&readlist_choice_for=mamund%40substack.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
					{
						newsletterName: "TLDR",
						senderEmail: "dan@tldrnewsletter.com",
						choiceUrl: "https://readplace.com/newsletters/gmail?sender=dan%40tldrnewsletter.com&notification=1&readlist_choice_for=dan%40tldrnewsletter.com&utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlist",
					},
				],
				gmailUrl: "https://readplace.com/newsletters/gmail?utm_source=gmail-newsletter-notice&utm_medium=email&utm_campaign=gmail-newsletter-mapping&utm_content=choose-readlists",
				waiting: 3,
			}).to("text/html"),
	},
	{
		slug: "user-data-export--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			buildUserDataExportEmailHtml({
				downloadUrl: "https://hutch-user-exports-prod.s3.ap-southeast-2.amazonaws.com/exports/944bd89b7f3dea9073c72bedad648df4/2026-10-06T05-17-44-312Z.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=ASIAIOSFODNN7EXAMPLE%2F20261006%2Fap-southeast-2%2Fs3%2Faws4_request&X-Amz-Date=20261006T051744Z&X-Amz-Expires=604800&X-Amz-Security-Token=IQoJb3JpZ2luX2VjECOuCv4z1WzgSJYnZ6NtjVo0urgC3ptD%2FbJr%2B0Yoy79kZmosULyG607XbAEFYEqOTpwsiYL%2BZ98RS1EksKuOxcHiCV636GPb5izUv0yDmKwbmuWJxS08y%2FSoJaHgZs5hv69YwzE1hPIwgLlEChNhz7AICvOBNINK28kUI4wfVaNrG9K4D0Cs4Kxtkv89cffmnjW9zCnEL0M9iiSp%2F4emxLyn913EYxCY3OgfA5qsO5UiTRMuTP%2FeDocx7%2Bfhg%2F3%2BeLpd7ZKemhoSXgvvY7OXKFGE%2FM9B7GYWyKXxoiNl8EvQuPIpp0EgFVcc0wyCEn3WBQtH3%2Fm%2BBJHI0tzQRM24kbJJMew7d4uKKbLsXH1cfBfM7QEorYYXF%2ByMOd3%2B5DMWrIsnoM6HNjgTZ0bLOHde%2Ff2oPyYba0iXcGPuuSib0nek0YHWIOIwGAOaDpqLwSJxTrUiHuYbAoj3HcNNZYc4Ibr1AKkFRps6TOBKnhZY04XgHhwBZn7fQCPBxsPtKr35k2VFBP0f1W71x3q6yPhA%2BjNIml4ZmgfUS2TfpMlwg5NQ5jc29tTzeXoKLTY3prb5bobzj7ydXvLGUu9xN6qHmGHXtGcCXKkromF6Exs86ftmYfvoNjencuavWiFfk9dbmtsUGuGrQZ5xUcZlWKjYxn3gVxXD59jNVHj5j9kglmCRTNDgLxmgMZAuASWdOOuegGqxDLB2kAXl73YaFkcXgf2DFcwVK4DNGonX8AkFEuNZJaxpZ3GMVMP1i2eSld70koGWVAlo2IsidT3laXhiUKV63jAzMaaakWD%2BOTADQeKsojhlW44JjaMuGdTdCZ8fbBZQauEWp9NKyUENpzudBjPkYj%2FwRFYUiP7D9Jh9Ue5v03kqQWM4GROhBW8DvevpMGAweljkwGEuQwFjVEtWK67fpMgGclD9hcU38BKYVvdPVzpJd28YAxhmFRh4E%2Bb5cQv6mPE7ZpyHb2pyDA0f3wnCahf1UX20dlYjWIsM2nq3c81QBQlp1Cm2o0CzGCDAQulM6xewfcOrDmGV%2BxqgZVDTjn7qIA9pWwVv4z47qNMQ%3D&X-Amz-Signature=eca0547fd269f10d4179de4009f3bd32d1fdc31cc1183f5061c549fa6e78cb86&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
				articleCount: 14,
				ttlDays: 7,
			}),
	},
	{
		slug: "user-data-export--single-article",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			buildUserDataExportEmailHtml({
				downloadUrl: "https://hutch-user-exports-prod.s3.ap-southeast-2.amazonaws.com/exports/c1c4bd92a3f35e7421ea2a3533ad7ab4/2026-10-06T05-17-44-357Z.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=ASIAIOSFODNN7EXAMPLE%2F20261006%2Fap-southeast-2%2Fs3%2Faws4_request&X-Amz-Date=20261006T051744Z&X-Amz-Expires=604800&X-Amz-Security-Token=IQoJb3JpZ2luX2VjECOuCv4z1WzgSJYnZ6NtjVo0urgC3ptD%2FbJr%2B0Yoy79kZmosULyG607XbAEFYEqOTpwsiYL%2BZ98RS1EksKuOxcHiCV636GPb5izUv0yDmKwbmuWJxS08y%2FSoJaHgZs5hv69YwzE1hPIwgLlEChNhz7AICvOBNINK28kUI4wfVaNrG9K4D0Cs4Kxtkv89cffmnjW9zCnEL0M9iiSp%2F4emxLyn913EYxCY3OgfA5qsO5UiTRMuTP%2FeDocx7%2Bfhg%2F3%2BeLpd7ZKemhoSXgvvY7OXKFGE%2FM9B7GYWyKXxoiNl8EvQuPIpp0EgFVcc0wyCEn3WBQtH3%2Fm%2BBJHI0tzQRM24kbJJMew7d4uKKbLsXH1cfBfM7QEorYYXF%2ByMOd3%2B5DMWrIsnoM6HNjgTZ0bLOHde%2Ff2oPyYba0iXcGPuuSib0nek0YHWIOIwGAOaDpqLwSJxTrUiHuYbAoj3HcNNZYc4Ibr1AKkFRps6TOBKnhZY04XgHhwBZn7fQCPBxsPtKr35k2VFBP0f1W71x3q6yPhA%2BjNIml4ZmgfUS2TfpMlwg5NQ5jc29tTzeXoKLTY3prb5bobzj7ydXvLGUu9xN6qHmGHXtGcCXKkromF6Exs86ftmYfvoNjencuavWiFfk9dbmtsUGuGrQZ5xUcZlWKjYxn3gVxXD59jNVHj5j9kglmCRTNDgLxmgMZAuASWdOOuegGqxDLB2kAXl73YaFkcXgf2DFcwVK4DNGonX8AkFEuNZJaxpZ3GMVMP1i2eSld70koGWVAlo2IsidT3laXhiUKV63jAzMaaakWD%2BOTADQeKsojhlW44JjaMuGdTdCZ8fbBZQauEWp9NKyUENpzudBjPkYj%2FwRFYUiP7D9Jh9Ue5v03kqQWM4GROhBW8DvevpMGAweljkwGEuQwFjVEtWK67fpMgGclD9hcU38BKYVvdPVzpJd28YAxhmFRh4E%2Bb5cQv6mPE7ZpyHb2pyDA0f3wnCahf1UX20dlYjWIsM2nq3c81QBQlp1Cm2o0CzGCDAQulM6xewfcOrDmGV%2BxqgZVDTjn7qIA9pWwVv4z47qNMQ%3D&X-Amz-Signature=e89065f32359a6c532851a231b4fbb88a4554715904d44381bc2f1b315383fe7&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
				articleCount: 1,
				ttlDays: 7,
			}),
	},
	{
		slug: "user-data-export--no-articles",
		widths: [DESKTOP],
		buttons: 1,
		html: () =>
			buildUserDataExportEmailHtml({
				downloadUrl: "https://hutch-user-exports-prod.s3.ap-southeast-2.amazonaws.com/exports/ae70c7d8d05cba7ca83575ce2d89516b/2026-10-06T05-17-44-373Z.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=ASIAIOSFODNN7EXAMPLE%2F20261006%2Fap-southeast-2%2Fs3%2Faws4_request&X-Amz-Date=20261006T051744Z&X-Amz-Expires=604800&X-Amz-Security-Token=IQoJb3JpZ2luX2VjECOuCv4z1WzgSJYnZ6NtjVo0urgC3ptD%2FbJr%2B0Yoy79kZmosULyG607XbAEFYEqOTpwsiYL%2BZ98RS1EksKuOxcHiCV636GPb5izUv0yDmKwbmuWJxS08y%2FSoJaHgZs5hv69YwzE1hPIwgLlEChNhz7AICvOBNINK28kUI4wfVaNrG9K4D0Cs4Kxtkv89cffmnjW9zCnEL0M9iiSp%2F4emxLyn913EYxCY3OgfA5qsO5UiTRMuTP%2FeDocx7%2Bfhg%2F3%2BeLpd7ZKemhoSXgvvY7OXKFGE%2FM9B7GYWyKXxoiNl8EvQuPIpp0EgFVcc0wyCEn3WBQtH3%2Fm%2BBJHI0tzQRM24kbJJMew7d4uKKbLsXH1cfBfM7QEorYYXF%2ByMOd3%2B5DMWrIsnoM6HNjgTZ0bLOHde%2Ff2oPyYba0iXcGPuuSib0nek0YHWIOIwGAOaDpqLwSJxTrUiHuYbAoj3HcNNZYc4Ibr1AKkFRps6TOBKnhZY04XgHhwBZn7fQCPBxsPtKr35k2VFBP0f1W71x3q6yPhA%2BjNIml4ZmgfUS2TfpMlwg5NQ5jc29tTzeXoKLTY3prb5bobzj7ydXvLGUu9xN6qHmGHXtGcCXKkromF6Exs86ftmYfvoNjencuavWiFfk9dbmtsUGuGrQZ5xUcZlWKjYxn3gVxXD59jNVHj5j9kglmCRTNDgLxmgMZAuASWdOOuegGqxDLB2kAXl73YaFkcXgf2DFcwVK4DNGonX8AkFEuNZJaxpZ3GMVMP1i2eSld70koGWVAlo2IsidT3laXhiUKV63jAzMaaakWD%2BOTADQeKsojhlW44JjaMuGdTdCZ8fbBZQauEWp9NKyUENpzudBjPkYj%2FwRFYUiP7D9Jh9Ue5v03kqQWM4GROhBW8DvevpMGAweljkwGEuQwFjVEtWK67fpMgGclD9hcU38BKYVvdPVzpJd28YAxhmFRh4E%2Bb5cQv6mPE7ZpyHb2pyDA0f3wnCahf1UX20dlYjWIsM2nq3c81QBQlp1Cm2o0CzGCDAQulM6xewfcOrDmGV%2BxqgZVDTjn7qIA9pWwVv4z47qNMQ%3D&X-Amz-Signature=9e2bbca61febba79cf983c71a89a0419c741e2225f5c359a5e984b591d8830f9&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
				articleCount: 0,
				ttlDays: 7,
			}),
	},
	{
		slug: "hacker-news-starter--default",
		widths: [DESKTOP, MOBILE],
		buttons: 1,
		html: () =>
			QueueDigestEmail({
				kind: "starter",
				starter: {
					readlist: ReadlistSlugSchema.parse("7c4e1a9f3b2d6e80"),
					campaignId: "hn-starter-v1",
				},
				items: [
					{
						articleId: ReaderArticleHashIdSchema.parse("05d1775554397973376adaf5128157d5"),
						title: "In defense of simple architectures",
						siteName: "danluu.com",
						preview: "Wave runs a multi-billion-dollar business on a Python monolith on top of Postgres, and the boring choices keep paying off.",
					},
					{
						articleId: ReaderArticleHashIdSchema.parse("950ad419d75c49c76313c873a64b0c1a"),
						title: "DNS \"propagation\" is actually caches expiring",
						siteName: "Julia Evans",
						preview: "Why DNS changes seem to take time to spread: resolvers keep cached records until their TTL runs out.",
					},
					{
						articleId: ReaderArticleHashIdSchema.parse("1257466dab1bdfd516fd9f2b37db3bc4"),
						title: "Appropriate Uses For SQLite",
						siteName: "SQLite",
						preview: "SQLite competes with fopen(), not with client/server databases, and fits most low-to-medium traffic websites.",
					},
				],
				links: {
					appOrigin: "https://readplace.com",
					sendId: "starter-3f1c9a7e5b2d4c8e6a0f1b3d5c7e9a2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a3c",
					unsubscribeToken: "4f9a1c7e2b3d48e6a0c5d9f1e7b2a6c3.9c2e7b4a1f6d3e8c5b0a7f2d4e9c1b6a3f8d5e2c7b0a4f9e1d6c3b8a5f2e7d0c",
				},
			}).to("text/html"),
	},
];

function withInterStylesheet(html: string): string {
	return html.replace("</head>", `<link rel="stylesheet" href="${INTER_STYLESHEET}"></head>`);
}

async function everyImagePainted(page: Page): Promise<void> {
	await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
}

async function buttonStaysInsideCard(button: Locator, card: MeasuredBox): Promise<void> {
	const box = await button.boundingBox();
	assert.ok(box, "every button must be laid out with a measurable box");
	assert.ok(box.x >= card.x - SUBPIXEL, `a button must start inside the card's left edge at ${card.x}px, got ${box.x}px`);
	assert.ok(
		box.x + box.width <= card.x + card.width + SUBPIXEL,
		`a button must end inside the card's right edge at ${card.x + card.width}px, got ${box.x + box.width}px`,
	);
	assert.ok(box.y >= card.y - SUBPIXEL, `a button must start inside the card's top edge at ${card.y}px, got ${box.y}px`);
	assert.ok(
		box.y + box.height <= card.y + card.height + SUBPIXEL,
		`a button must end inside the card's bottom edge at ${card.y + card.height}px, got ${box.y + box.height}px`,
	);
}

async function cardCentredWithEveryButtonInside(
	page: Page,
	layout: { buttons: number; cardPadding: number },
): Promise<void> {
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "an email must never scroll sideways");
	const viewport = page.viewportSize();
	assert.ok(viewport, "an email must be measured in a fixed viewport");
	const card = await measuredBox(page, CARD);
	const left = card.x;
	const right = viewport.width - card.x - card.width;
	assert.ok(
		Math.abs(left - right) <= 1,
		`the card must sit centred in the ${viewport.width}px viewport, got ${left}px left and ${right}px right of it`,
	);
	assert.ok(card.width <= CARD_MAX_WIDTH, `the card must be at most ${CARD_MAX_WIDTH}px wide, got ${card.width}px`);
	assert.ok(
		Math.min(left, right) >= SIDE_PADDING - SUBPIXEL,
		`the card must stay inside the email's ${SIDE_PADDING}px side padding, got ${Math.min(left, right)}px`,
	);
	const cardBody = await measuredBox(page, CARD_BODY);
	const firstChild = await measuredBox(page, CARD_BODY_FIRST_CHILD);
	assert.ok(
		Math.abs(firstChild.x - cardBody.x - layout.cardPadding) <= SUBPIXEL,
		`the card body must pad its content by ${layout.cardPadding}px in a ${viewport.width}px viewport, got ${firstChild.x - cardBody.x}px`,
	);
	await expect(page.locator(BUTTON)).toHaveCount(layout.buttons);
	await Promise.all((await page.locator(BUTTON).all()).map((button) => buttonStaysInsideCard(button, card)));
}

test.describe("Emails customers receive", () => {
	test.use({ timezoneId: "UTC", colorScheme: "light", viewport: DESKTOP.viewport });

	for (const email of CUSTOMER_EMAILS) {
		for (const width of email.widths) {
			test(`${email.slug} renders as one centred card with every button inside it at ${width.name} width`, async ({ page }) => {
				await page.setViewportSize(width.viewport);
				await page.setContent(withInterStylesheet(email.html()), { waitUntil: "load" });
				await captureCheckpoint(page, {
					name: `${email.slug}--${width.name}`,
					settled: everyImagePainted,
					geometry: async (measuring) => {
						await fitViewportToPage(measuring, width.viewport);
						await cardCentredWithEveryButtonInside(measuring, {
							buttons: email.buttons,
							cardPadding: width.cardPadding,
						});
					},
					target: WHOLE_EMAIL,
					capture: "element",
					pinnedText: [],
				});
			});
		}
	}
});
