import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";

/**
 * Outbound-email authentication for the domain whose humans send via Google
 * Workspace (Gmail): the apex SPF record and the Workspace DKIM key.
 *
 * Why: a reply sent from Gmail (e.g. fayner@readplace.com) to a Sign in with
 * Apple `@privaterelay.appleid.com` address is forwarded by Apple's relay only
 * if it passes SPF or DKIM aligned to the From domain. Google Workspace sends
 * with the apex as the envelope (Return-Path) domain, so the apex needs its own
 * SPF authorising Google's servers, plus the Workspace DKIM public key.
 *
 * This is a SEPARATE sending path from the app's transactional mail, which goes
 * through Resend and authenticates on its own `send.<domain>` envelope subdomain
 * (`send.<domain>` SPF/MX and `resend._domainkey` are managed outside Pulumi, via
 * Resend). This component neither touches nor conflicts with those records — a
 * domain may hold one apex SPF record and any number of `send.`-scoped ones.
 *
 * Data-driven from config (no env-name branch): a stack whose mail is not on
 * Google Workspace (e.g. staging, which receives via SES) omits the config and
 * never constructs this component.
 */
export class OutboundMailAuth extends pulumi.ComponentResource {
	constructor(
		name: string,
		args: {
			mailDomain: string;
			/**
			 * The complete apex TXT record set. Route53 permits only one TXT set per
			 * name, so this one array must list every value the apex should hold — the
			 * Google Workspace SPF (`v=spf1 include:_spf.google.com ~all`) plus any
			 * pre-existing token such as `google-site-verification=…`. Add new apex
			 * TXT here, not in the DNS console, or the next deploy's overwrite drops it.
			 */
			apexTxt: string[];
			/**
			 * DKIM public-key record value from Google Admin → Apps → Google
			 * Workspace → Gmail → Authenticate email (host
			 * `google._domainkey.<mailDomain>`, selector "google"). Left unset until
			 * generated in the console, so Pulumi never publishes an empty/invalid
			 * DKIM record — until then only the apex TXT is created.
			 */
			googleDkimRecord?: string;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:OutboundMailAuth", name, {}, opts);

		const zoneId = aws.route53
			.getZone({ name: args.mailDomain }, { parent: this })
			.then((zone) => zone.zoneId);

		// The apex TXT set (Google Workspace SPF + any pre-existing tokens). Route53
		// holds one TXT set per name, so every value shares this single record;
		// `apexTxt` lists them all. `allowOverwrite` lets Pulumi adopt an apex TXT set
		// created outside Pulumi (UPSERT) instead of failing with "already exists".
		// The app's Resend mail authenticates on its own `send.<domain>` record and
		// is untouched by this apex set.
		assert(args.apexTxt.length > 0, "OutboundMailAuth: apexTxt must contain at least the SPF value");
		new aws.route53.Record(
			`${name}-apex-spf`,
			{
				zoneId,
				name: args.mailDomain,
				type: "TXT",
				ttl: 600,
				records: args.apexTxt,
				allowOverwrite: true,
			},
			{ parent: this },
		);

		if (args.googleDkimRecord) {
			new aws.route53.Record(
				`${name}-google-dkim`,
				{
					zoneId,
					name: `google._domainkey.${args.mailDomain}`,
					type: "TXT",
					ttl: 600,
					records: [splitTxtForRoute53(args.googleDkimRecord)],
				},
				{ parent: this },
			);
		}

		this.registerOutputs({});
	}
}

/**
 * Route53 does not auto-split TXT strings at the 255-byte DNS per-string limit,
 * which a 2048-bit DKIM key exceeds. The AWS provider's supported form is one
 * record whose value is several character-strings joined with `""` at each
 * boundary. See https://github.com/pulumi/pulumi-aws/issues/5451.
 */
function splitTxtForRoute53(value: string): string {
	const chunks = value.match(/[\s\S]{1,255}/g);
	assert(chunks, "DKIM record value must be non-empty");
	return chunks.join('""');
}
