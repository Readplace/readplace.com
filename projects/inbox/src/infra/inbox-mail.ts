import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { HutchS3ReadWrite } from "@packages/hutch-infra-components/infra";

/**
 * AWS SES inbound email receiving for the forwarding-address feature. Provisions
 * the SES domain identity + DKIM, the MX/TXT/CNAME records (added to the EXISTING
 * `read.place` Route53 zone — no NS-delegation step), the immutable raw-email S3
 * bucket (kept forever — no expiration rules), and the receipt rule that stores
 * each `.eml` to S3 and publishes the receipt to SNS. The receive queue
 * subscribes to {@link notificationTopicArn} in the composition root.
 *
 * Everything is data-driven from config (mail domain, parent zone, bucket name)
 * so prod and staging differ only in their Pulumi yaml — there is no env-name
 * branch in this file.
 */
export class InboxMail extends pulumi.ComponentResource {
	/** SNS topic SES publishes each inbound receipt to (S3 object key + SES
	 * metadata: recipients, receipt timestamp, messageId). SES cannot target SQS
	 * directly, so this topic is the supported bridge into the async backbone. */
	public readonly notificationTopicArn: pulumi.Output<string>;

	constructor(
		name: string,
		args: {
			mailDomain: string;
			inboxMailParentZone: string;
			rawEmailBucketName: string;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		// `hutch:` rather than `inbox:` because this component was declared by the
		// hutch stack until the inbox took ownership of it, and a component's type
		// token is embedded in the URN of every resource beneath it. Renaming it
		// would re-URN the SES identity, the MX record, and the receipt rule that
		// carry live mail — recoverable only via aliases, for a cosmetic gain.
		super("hutch:infra:InboxMail", name, {}, opts);

		// `read.place` is already a Route53 hosted zone (it redirects to
		// readplace.com today), so M2 only ADDS records — there is no registrar
		// NS step. A subdomain mail domain (staging.read.place) publishes its
		// records into this same parent zone, selected by config, never by env name.
		const zoneId = aws.route53
			.getZone({ name: args.inboxMailParentZone }, { parent: this })
			.then((zone) => zone.zoneId);

		const accountId = pulumi.output(aws.getCallerIdentity({}, { parent: this })).accountId;

		// Why: SES email receiving is offered in a receiving-enabled region subset
		// that includes ap-southeast-2 (this stack's region), so the receipt rule
		// needs no cross-region provider and the MX targets that region's endpoint.
		const region = aws.config.requireRegion();

		const identity = new aws.ses.DomainIdentity(
			`${name}-identity`,
			{ domain: args.mailDomain },
			{ parent: this },
		);
		new aws.route53.Record(
			`${name}-verification`,
			{
				zoneId,
				name: `_amazonses.${args.mailDomain}`,
				type: "TXT",
				ttl: 600,
				records: [identity.verificationToken],
			},
			{ parent: this },
		);

		// DKIM is a sending feature, harmless for receiving, and seeds the M5
		// SPF/DKIM-enforcement work.
		const dkim = new aws.ses.DomainDkim(
			`${name}-dkim`,
			{ domain: args.mailDomain },
			{ parent: this },
		);
		for (let index = 0; index < 3; index++) {
			new aws.route53.Record(
				`${name}-dkim-${index}`,
				{
					zoneId,
					name: dkim.dkimTokens.apply(
						(tokens) => `${tokens[index]}._domainkey.${args.mailDomain}`,
					),
					type: "CNAME",
					ttl: 600,
					records: [dkim.dkimTokens.apply((tokens) => `${tokens[index]}.dkim.amazonses.com`)],
				},
				{ parent: this },
			);
		}

		// Apex MX coexists with the redirect zone's apex A alias (different record
		// types), so web-redirect and mail-receiving share the same apex.
		new aws.route53.Record(
			`${name}-mx`,
			{
				zoneId,
				name: args.mailDomain,
				type: "MX",
				ttl: 300,
				records: [`10 inbound-smtp.${region}.amazonaws.com`],
			},
			{ parent: this },
		);

		// Immutable raw-email store. No expiration rules => kept forever (our
		// durability, our audit artifact). The body is parsed/sanitized into the
		// content bucket separately; this bucket is the single source of truth.
		const rawBucket = new HutchS3ReadWrite(
			`${name}-raw`,
			{ bucketName: args.rawEmailBucketName },
			{ parent: this },
		);
		// SES receiving requires the raw bucket to grant ses.amazonaws.com
		// PutObject, scoped to our account via aws:Referer. A named service
		// principal with an account condition is not "public", so it coexists with
		// the bucket's public-access block.
		const rawBucketPolicy = new aws.s3.BucketPolicy(
			`${name}-raw-policy`,
			{
				bucket: rawBucket.bucket,
				policy: pulumi.all([rawBucket.arn, accountId]).apply(([bucketArn, account]) =>
					JSON.stringify({
						Version: "2012-10-17",
						Statement: [
							{
								Sid: "AllowSESPut",
								Effect: "Allow",
								Principal: { Service: "ses.amazonaws.com" },
								Action: "s3:PutObject",
								Resource: `${bucketArn}/*`,
								Condition: { StringEquals: { "aws:Referer": account } },
							},
						],
					}),
				),
			},
			{ parent: this },
		);

		const topic = new aws.sns.Topic(`${name}-notifications`, {}, { parent: this });
		new aws.sns.TopicPolicy(
			`${name}-notifications-policy`,
			{
				arn: topic.arn,
				policy: pulumi.all([topic.arn, accountId]).apply(([topicArn, account]) =>
					JSON.stringify({
						Version: "2012-10-17",
						Statement: [
							{
								Sid: "AllowSESPublish",
								Effect: "Allow",
								Principal: { Service: "ses.amazonaws.com" },
								Action: "SNS:Publish",
								Resource: topicArn,
								Condition: { StringEquals: { "AWS:SourceAccount": account } },
							},
						],
					}),
				),
			},
			{ parent: this },
		);

		const ruleSet = new aws.ses.ReceiptRuleSet(
			`${name}-rule-set`,
			{ ruleSetName: `${name}-rules` },
			{ parent: this },
		);
		// Catch-all on the whole mail domain: forwarding addresses are minted
		// dynamically, so the rule cannot enumerate recipients. The S3 action stores
		// the raw .eml under inbound/<sesMessageId> then publishes the receipt
		// (object key + SES metadata) to SNS.
		new aws.ses.ReceiptRule(
			`${name}-rule`,
			{
				ruleSetName: ruleSet.ruleSetName,
				recipients: [args.mailDomain],
				enabled: true,
				scanEnabled: true,
				s3Actions: [
					{
						position: 1,
						bucketName: rawBucket.bucket,
						objectKeyPrefix: "inbound/",
						topicArn: topic.arn,
					},
				],
			},
			{ parent: this, dependsOn: [rawBucketPolicy] },
		);
		// Exactly one active receipt rule set per account/region (account-global).
		// Confirmed no other product in this account uses SES receiving.
		new aws.ses.ActiveReceiptRuleSet(
			`${name}-active`,
			{ ruleSetName: ruleSet.ruleSetName },
			{ parent: this },
		);

		this.notificationTopicArn = topic.arn;
		this.registerOutputs({ notificationTopicArn: this.notificationTopicArn });
	}
}
