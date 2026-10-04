# Newsletter catalog

The newsletter catalog is the shared list of FROM addresses that GMail Newsletters recognises as newsletters. It decides:

- which senders the Gmail page's newsletter picker offers by default, and under which name;
- which saved mappings are *not* submitted to the catalog, because the sender already has an approved record of its own;
- which unmapped senders can produce a one-time email inviting the reader to choose a readlist.

A reader's own mapping never depends on the catalog. A reader can map any discovered sender, and that mapping keeps forwarding into the chosen readlist whether the catalog later approves, rejects or withdraws the sender.

## Where it lives

| | Staging | Production |
|---|---|---|
| Bucket | `hutch-newsletter-catalog-staging` | `hutch-newsletter-catalog-prod` |
| Object | `newsletter-catalog.json` | `newsletter-catalog.json` |
| AWS account | default credentials | `--profile hutch-production` |

Both are in `ap-southeast-2`. The bucket is private. The web Lambda (`hutch`) and the `newsletter-catalog-suggestions` Lambda read and write it. Gmail monitoring and notification workers read it to check approval.

The object is one JSON document, `{ "version": 1, "records": [...] }`, validated by `NewsletterCatalogDocumentSchema` in `@packages/domain/newsletter-catalog`. Each record has:

- `from`: the exact FROM address, lower-cased, or a domain wildcard `*@example.com`, which matches every address at exactly `example.com` (not `mail.example.com`, not a parent domain). Each `from` appears in one record only.
- `name` (optional): the newsletter name readers see once the record is approved.
- `status`: `pending`, `approved` or `rejected`. **Only `approved` records identify newsletters.**
- `evidence`: every piece of evidence ever recorded, each with a `kind` (`seed`, `user-submission` or `admin`), an optional `url`, an optional `note` and `addedAt`.
- `replacedBy` (optional): set on the old record when an admin corrects a FROM address.
- `createdAt`, `updatedAt` and `reviewedAt`.

A missing object reads as an empty catalog. The first write creates it.

## Which record decides a sender

The most specific record wins:

1. **The sender's own record decides, whatever its status.** The sender is recognised only when that record is `approved`. A `rejected` or `pending` record of its own keeps it unrecognised even when an approved wildcard covers its domain, so one address can be carved out of a wildcard.
2. **Only a sender with no record of its own falls through to the wildcard.** An `approved` `*@<the sender's domain>` record then recognises it, under the wildcard's name.
3. **A record with `replacedBy` set does not decide.** It records a correction, not a verdict on the address, so the sender falls through to the wildcard. When an admin corrects `mamund@substack.com` to `*@substack.com`, `mamund@substack.com` stays recognised through the approved wildcard.

## Approved newsletter notifications

Every six hours, Readplace checks connected Gmail accounts using the existing metadata permission. A reader receives one email at their **Readplace account address** for an approved newsletter sender they have not mapped when new mail arrives, or when a sender already observed in their current mailbox becomes approved. Each actual FROM address gets its own notice, including addresses recognised through a domain wildcard. There are no reminders.

The first check establishes a silent baseline from the existing discovered senders for that mailbox and the recent discovery window of approximately 5,000 messages. Already-approved newsletters in that baseline produce no initial batch of emails. Readplace captures the Gmail history cursor before scanning and processes arrivals during initialization, so mail arriving while the baseline is being built remains eligible. Spam, trash, drafts and outbound-only messages are excluded. Label changes do not count as arrivals.

Observed senders are kept even when the catalog does not recognise them. Every check also pages through the current mailbox's interactive discovery cache, retaining senders discovered after initialization even when they fall outside the recent-message window. Each subsequent check compares their effective recognition using [the same exact-address and wildcard rules](#which-record-decides-a-sender). An admin's approval can therefore produce a notice without another issue arriving. Renaming a newsletter, or adding an automatically approved exact record under an already-approved wildcard, leaves recognition unchanged and produces no approval notice. A pending or rejected exact record still overrides an approved wildcard.

Before sending, Readplace checks the live catalog, current connection and current mapping again. A mapped sender, revoked or disconnected account, changed mailbox, or unavailable catalog does not receive a notice. Removing a mapping by itself does not trigger one. A later qualifying arrival or approval can still notify an address that has never received a notice.

Notification receipts belong to the Readplace user and lower-cased sender address. They survive mapping removal, disconnect and reconnect, including reconnecting to another Gmail mailbox. Reconnecting the same mailbox preserves its observations and cursor. Changing mailboxes initializes a fresh observation set and cursor; earlier observations remain outside the active mailbox until account deletion erases observations, checkpoints, pending notices and receipts.

The monitor's history cursor is separate from interactive sender discovery. Interrupted pages resume from durable checkpoints, including a saved notice-dispatch list when publication must be retried after the page advanced. When Gmail rejects an expired history cursor, Readplace performs a paginated metadata resynchronization while retaining observations and notification history. Gmail requires a full synchronization after an expired cursor returns HTTP 404. See the [Gmail history API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list).

### Following the email

The email names the newsletter when the catalog supplies a name, includes its FROM address, and explains that the reader can save future issues to a readlist. Its tracked **Choose a readlist** link opens `/newsletters/gmail` with that sender selected; signing in returns the reader to the same selection. The page accepts monitored senders only from the signed-in reader's current mailbox.

When the reader has multiple readlists, the destination remains unselected and **Save** stays disabled until they choose one. When **All** is the only readlist, it is selected and Save is available. A sender mapped after the email was sent opens its existing mapping, preserving that destination.

On arrival from the email, the readlist selector and Save have a distinct brand-colour border. The first click anywhere, including on disabled Save, clears both borders. The dismissal survives htmx refreshes. Keyboard focus remains visible; the border adds no layout shift. The arrival marker is a presentation hint and is excluded from later form and polling URLs. The underlying forms still work without JavaScript.

Saving uses the existing mapping and Gmail filter update. Importing the sender's earlier unread messages from the last 30 days remains a separate, explicit option; following the email does not start an import.

### Delivery retries

The monitoring table stores pending notices and permanent sent receipts. An atomic claim reserves each user/sender notice, and its rendered email payload and provider idempotency key remain stable across retries. Resend retains idempotency keys for 24 hours; changing a payload under the same key is refused. See [Resend's idempotency announcement](https://resend.com/changelog/idempotency-keys).

If delivery is ambiguous, retries use the same payload and key only inside that window, stopping after 23 hours and 55 minutes to leave a five-minute margin. An unresolved attempt beyond that cutoff fails to the notification queue's DLQ for operator review, preserving the claim rather than risking a second email automatically. Review the provider's delivery evidence before any manual recovery; re-driving an expired ambiguous attempt does not authorize a new send.

## Seed provenance

The version-controlled seed is `src/runtime/domain/newsletter-catalog/newsletter-catalog.seed.json`. It is never written to S3 on its own: an admin imports it (see [Importing the seed](#importing-the-seed)) and then approves each entry.

| FROM address | Name | Evidence |
|---|---|---|
| `enewsletter@scottishnews.com` | Scottish Legal News | The publisher's [email delivery page](https://www.scottishlegal.com/email-delivery-issues) names this address as the newsletter sender (fetched 2026-09-30, re-checked 2026-10-01). |
| `newsletter@energyandcapital.com` | Energy & Capital | The publisher's [whitelist page](https://www.energyandcapital.com/whitelist/) names this address for every mail provider (fetched 2026-09-30, re-checked 2026-10-01). |
| `hello@cgxapp.com` | CGX | The [support article](https://support.cgxapp.com/hc/en-gb/articles/30688454926353-Why-haven-t-I-received-the-email-newsletter) asks readers to whitelist the address the newsletter is sent from, `hello@cgxapp.com` (fetched through the Zendesk article API, 2026-09-30, re-checked 2026-10-01). |
| `briefs@dailydosebriefs.com` | Daily Dose | The [site FAQ](https://www.dailydosebriefs.com/) says to add `briefs@dailydosebriefs.com` to contacts (fetched 2026-09-30, re-checked 2026-10-01). |
| `googlealerts-noreply@google.com` | Google Alerts | Google's [Alerts help page](https://support.google.com/websearch/answer/4815696) tells Gmail users to add this address to contacts (fetched 2026-10-01). |
| `newsletter.email@businessinsider.com` | Business Insider | The [help-centre article](https://businessinsider.zendesk.com/hc/en-us/articles/7238332605965-I-m-not-receiving-the-newsletters-I-subscribed-to) asks readers to allowlist this address for newsletter delivery (fetched through the Zendesk article API, 2026-10-01). |
| `newsletters@analystratings.net` | MarketBeat | MarketBeat's [safe-sender page](https://www.marketbeat.com/safe-sender) names this address as the newsletter sender (fetched 2026-10-01). |
| `oxford@mp.oxfordclub.com` | The Oxford Club | The [whitelist page](https://oxfordclub.com/whitelist) names this address as the "From" line of its e-letters (fetched 2026-10-01). |
| `dr@email.paradigmpressgroup.com`, `dailyproof@email.paradigmpressgroup.com`, `dailyfwd@email.paradigmpressgroup.com` | The Daily Reckoning | The [whitelist page](https://dailyreckoning.com/whitelist) lists all three as the "From" line of subscription email (fetched 2026-10-01). One record each. |
| `info@mp.paradigmpressgroup.com`, `info@mb.paradigmpressgroup.com`, `vip@mb.paradigmpressgroup.com` | Paradigm Press | The publisher's [whitelist page](https://paradigmpressgroup.com/whitelist-us) lists all three as sending addresses (fetched 2026-10-01). One record each. |
| `jsw@peterc.org` | JavaScript Weekly | From header of real mail in a Readplace test mailbox, seen by staging Gmail sender discovery (2026-10-01). No publisher page names it. |
| `jakub@programmingdigest.net` | Programming Digest | From header of real mail in a Readplace test mailbox (2026-10-01). |
| `jakub@mail.leadershipintech.com` | Leadership in Tech | From header of real mail in a Readplace test mailbox (2026-10-01). |
| `anton@newsletter.manager.dev` | Manager.dev | From header of real mail in a Readplace test mailbox (2026-10-01). The publication's site has since moved off `newsletter.manager.dev`; re-check the sender if issues arrive from another address. |
| `mamund@substack.com` | Signals from Our Futures Past | From header of real mail in a Readplace test mailbox (2026-10-01); `mamund.substack.com` is that publication. |

The seed has no domain wildcards. No checked domain had evidence that it sends newsletter issues only: each also carries support, account or sign-in mail, or is shared by many publishers.

Checked and left out:

| Sender | Why |
|---|---|
| `pragmaticengineer@substack.com` | No publisher page or real From header names it. Substack only documents the `[subdomain]@substack.com` format, which is inference. |
| `noreply@medium.com` | Medium's help centre says this address also sends sign-in links. |
| `subscriptions@medium.com` | No evidence of what it sends. |
| `newsletters-noreply@linkedin.com` | A platform relay for any author's LinkedIn newsletter; no page names it. |
| `02ship@mail.beehiiv.com` | The publication could not be identified, and beehiiv also sends subscription-verification mail from publication addresses. |
| `hn@ycombinator.com` | The Hacker News moderator and support mailbox, not a newsletter. |
| `info@mb.banyanhill.com` | The publisher says "All Banyan Hill emails" come from it, which can include account mail. |

Every seed entry imports as `pending`. Adding an entry to the seed file only makes it available to the next import; it does not change a live catalog.

## Verifying an address

Approve an exact-address record only when you know the exact address in the `From` header of the newsletter's mail. Acceptable evidence:

- a page on the publisher's own site that names the full address (a whitelist, "add us to your contacts" or delivery-help page); or
- the `From` header of a real issue (in Gmail: *Show original*).

A domain wildcard names no single address, so the evidence for it is about the whole domain: the domain owner's own documentation of which of its addresses send what. Every address that documentation names as sending sign-in links, password resets, receipts or support mail must already have a `rejected` record of its own before the wildcard is approved (see the wildcard rule below).

Rules:

- Use the address exactly. Keep dots and plus tags (`news+weekly@example.com` is not `news@example.com`). Addresses are compared after lower-casing only.
- Never approve an address that also sends sign-in links, password resets or receipts. A reader's mapping forwards everything that address sends into a readlist.
- Approve a domain wildcard only for a domain that sends nothing but newsletters. A wildcard recognises every address at its domain that has no record of its own: `*@substack.com` also matches `no-reply@substack.com`, which Substack's [sign-in help article](https://support.substack.com/hc/en-us/articles/360059542452-How-do-I-log-into-my-Substack-account) names as the sender of sign-in emails (fetched through the Zendesk article API, 2026-10-02). Give such an address a `rejected` record of its own first; that record then keeps it unrecognised under the wildcard.
- Never infer an address from a website's domain, a sign-up form or a "reply-to" address. A publication on `example.com` may send from `example.substack.com`, from a mailing-list provider, or from several addresses.
- One FROM address has one record, even when several editions share it. Name the record after the publication a reader would recognise.
- Record where the address came from: an evidence link, a note, or both. The admin create form requires one of them.

## Admin procedure

Admins are the accounts listed in the web Lambda's `ADMIN_EMAILS`. Sign in with one of them and open `/admin`, then **Newsletters** (`/admin/newsletters`). The recrawl service token does not open these pages; only an admin session does.

The list has four tabs: **Pending** (the default, oldest first), **Approved**, **Rejected** and **All** (the last three newest change first). Search matches any part of the FROM address or name within the current tab. Fifty records show per page.

| Action | Available on | Result |
|---|---|---|
| Add newsletter | any tab | Creates a `pending` record with admin evidence. A FROM address that already has a record is refused. |
| Edit | every record | Changes the name. Evidence you add is appended; existing evidence is kept. The status is unchanged. |
| Approve | pending | `approved`: readers see the sender as a known newsletter, under its name. |
| Reject | pending | `rejected`: the sender is not recognised, and repeat reader submissions leave it rejected. |
| Withdraw | approved | `rejected`: readers stop seeing the sender as a known newsletter. Their mappings keep working. |
| Reconsider | rejected, unless replaced by a corrected FROM | Back to `pending`. A replaced record stays rejected, and neither Reconsider nor a reader submission ever reopens it. It does not decide its old address, which an approved wildcard for that address's domain still recognises (see [Which record decides a sender](#which-record-decides-a-sender)). |
| Correct FROM | pending, approved | Creates the corrected address as a new `pending` record with the old name and evidence, plus a note naming the old address. The old record becomes `rejected` with `replacedBy` set, so reader submissions of the old address never reopen it. Approve the corrected record explicitly. A rejected record is never corrected, even from a form opened before it was rejected. |

### Reader submissions

When a reader saves a mapping for a sender without an approved record of its own (including one recognised only through a domain wildcard, and including when the catalog is unavailable), Readplace submits the FROM address only, as a `SubmitNewsletterSender` command. Nothing else about the reader, their mailbox or their readlist is sent.

The `newsletter-catalog-suggestions` Lambda adds a record only when the address has none of its own:

- **Under an approved wildcard for the sender's domain**, the address is added as `approved`, named after the wildcard, with `user-submission` evidence whose note names the wildcard it matched (`Approved automatically: matches the approved *@substack.com.`). The wildcard already vouches for every address at its domain, so the submission is not queued for review; the address's own record lets an admin rename or withdraw it individually. The submission reports `created-approved`.
- **Otherwise** the address is added as `pending` with `user-submission` evidence, for an admin to review. The submission reports `created-pending`.

An address that already has a record, in any status, is left exactly as it is and the submission reports `already-present`: a submission never renames a record, never approves over a pending review or a rejection, and never reopens a replaced record.

Withdrawing a wildcard does not cascade. The records it approved automatically stay `approved`; withdraw each of them as well if they should stop being recognised.

### Importing the seed

On the Pending tab, press **Import seed**. Seed entries whose FROM address is absent from the catalog are added as `pending` with `seed` evidence. Entries already in the catalog, in any status, are left exactly as they are, so importing twice changes nothing. Then review and approve each new pending record.

## Conditional writes and conflicts

Every write sends the ETag of the document it was based on (`If-Match`), or `If-None-Match: *` when the object does not exist yet. S3 refuses the write when another writer got there first, so no change silently overwrites another.

- **Reader submissions and seed imports** re-read the latest document and re-apply their change when a write is refused, up to three attempts. A submission that still cannot be stored is retried by its SQS queue and ends in that queue's dead-letter queue.
- **Admin changes** are checked twice. Each form carries the record's `updatedAt` from when the page was loaded; if the record changed since then, the change is refused with **409** and a conflict alert. The form keeps what you typed, shows the current record beside it, and is re-based on the current version, so submitting again applies your values on top of what the other admin did. Row actions (approve, reject, withdraw, reconsider) re-render the list with the current state instead.
- A write refused for a change to a *different* record is re-applied automatically, because the change is re-computed against the latest document.
- If S3 is unreachable, the page answers **503** with a storage alert and nothing is changed. When the catalog cannot be read, the page says so and lists no records; it never presents the catalog as empty.

Each web Lambda container keeps its last parsed document and revalidates it with `If-None-Match` on every read, so every change is visible on the next page load.

## Recovering from an incorrect publication

**A wrong record** (wrong address, wrong name, approved by mistake):

- Approved by mistake: **Withdraw** it. The sender stops being recognised at once; readers' mappings keep forwarding.
- A domain wildcard approved by mistake: **Withdraw** it, then withdraw each record it approved automatically. Withdrawing the wildcard stops recognising only the senders at its domain with no record of their own; the records reader submissions created under it stay `approved` (see [Reader submissions](#reader-submissions)). Find them on the Approved tab by searching for the domain: they carry the wildcard's name and `user-submission` evidence noting `Approved automatically: matches the approved *@<domain>.`
- Wrong FROM address: **Correct FROM**, then approve the corrected record once verified.
- Wrong name: **Edit** it.

No record is ever deleted, so the evidence trail stays intact.

**A document that no longer parses** (for example after a manual edit): every read, the newsletter picker's suggestions and every admin write return "unavailable" until the object is fixed. Readers can still search and map any sender; only recognition is missing. There is no repository command for this, and the bucket has no versioning (adding it needs its own evidence-backed change). Restore a valid document out of band:

1. Download the current object for reference:

   ```bash
   aws s3 cp s3://hutch-newsletter-catalog-prod/newsletter-catalog.json ./broken-catalog.json --profile hutch-production
   ```

2. Fix it by hand, or rebuild it: an object containing `{"version":1,"records":[]}` is valid. Check that every `from` is unique and every timestamp is an ISO date-time.
3. Upload the fixed document:

   ```bash
   aws s3 cp ./fixed-catalog.json s3://hutch-newsletter-catalog-prod/newsletter-catalog.json --content-type application/json --profile hutch-production
   ```

4. If you started from an empty document, open `/admin/newsletters`, press **Import seed**, and re-approve the verified records. Reader submissions will re-add unknown senders as they come in.

Use the staging bucket name and default credentials to rehearse in staging first.
