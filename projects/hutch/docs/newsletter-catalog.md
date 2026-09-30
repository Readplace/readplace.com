# Newsletter catalog

The newsletter catalog is the shared list of FROM addresses that GMail Newsletters recognises as newsletters. It decides two things only:

- which senders the Gmail page's newsletter picker offers by default, and under which name;
- which saved mappings are *not* sent for review, because the sender is already approved.

A reader's own mapping never depends on the catalog. A reader can map any discovered sender, and that mapping keeps forwarding into the chosen readlist whether the catalog later approves, rejects or withdraws the sender.

## Where it lives

| | Staging | Production |
|---|---|---|
| Bucket | `hutch-newsletter-catalog-staging` | `hutch-newsletter-catalog-prod` |
| Object | `newsletter-catalog.json` | `newsletter-catalog.json` |
| AWS account | default credentials | `--profile hutch-production` |

Both are in `ap-southeast-2`. The bucket is private. The web Lambda (`hutch`) and the `newsletter-catalog-suggestions` Lambda are the only readers and writers.

The object is one JSON document, `{ "version": 1, "records": [...] }`, validated by `NewsletterCatalogDocumentSchema` in `@packages/domain/newsletter-catalog`. Each record has:

- `from`: the exact FROM address, lower-cased. Each address appears in one record only.
- `name` (optional): the newsletter name readers see once the record is approved.
- `status`: `pending`, `approved` or `rejected`. **Only `approved` records identify newsletters.**
- `evidence`: every piece of evidence ever recorded, each with a `kind` (`seed`, `user-submission` or `admin`), an optional `url`, an optional `note` and `addedAt`.
- `replacedBy` (optional): set on the old record when an admin corrects a FROM address.
- `createdAt`, `updatedAt` and `reviewedAt`.

A missing object reads as an empty catalog. The first write creates it.

## Seed provenance

The version-controlled seed is `src/runtime/domain/newsletter-catalog/newsletter-catalog.seed.json`. It is never written to S3 on its own: an admin imports it (see [Importing the seed](#importing-the-seed)) and then approves each entry.

| FROM address | Name | Evidence |
|---|---|---|
| `enewsletter@scottishnews.com` | Scottish Legal News | The publisher's [email delivery page](https://www.scottishlegal.com/email-delivery-issues) names this address as the newsletter sender (fetched 2026-09-30). |
| `newsletter@energyandcapital.com` | Energy & Capital | The publisher's [whitelist page](https://www.energyandcapital.com/whitelist/) names this address for every mail provider (fetched 2026-09-30). |
| `hello@cgxapp.com` | CGX | The [support article](https://support.cgxapp.com/hc/en-gb/articles/30688454926353-Why-haven-t-I-received-the-email-newsletter) asks readers to whitelist the address the newsletter is sent from, `hello@cgxapp.com` (fetched through the Zendesk article API, 2026-09-30). |
| `briefs@dailydosebriefs.com` | Daily Dose | The [site FAQ](https://www.dailydosebriefs.com/) says to add `briefs@dailydosebriefs.com` to contacts (fetched 2026-09-30). |
| `pragmaticengineer@substack.com` | The Pragmatic Engineer | Supplied user feedback about a Substack publication sender. There is no publisher page naming the address. **Verify it against the From header of a real issue before approving.** |

Every seed entry imports as `pending`. Adding an entry to the seed file only makes it available to the next import; it does not change a live catalog.

## Verifying an address

Approve a record only when you know the exact address in the `From` header of the newsletter's mail. Acceptable evidence:

- a page on the publisher's own site that names the full address (a whitelist, "add us to your contacts" or delivery-help page); or
- the `From` header of a real issue (in Gmail: *Show original*).

Rules:

- Use the address exactly. Keep dots and plus tags (`news+weekly@example.com` is not `news@example.com`). Addresses are compared after lower-casing only.
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
| Reconsider | rejected, unless replaced by a corrected FROM | Back to `pending`. A replaced record stays rejected, so the old address is never recognised beside its correction. |
| Correct FROM | pending, approved | Creates the corrected address as a new `pending` record with the old name and evidence, plus a note naming the old address. The old record becomes `rejected` with `replacedBy` set, so reader submissions of the old address never reopen it. Approve the corrected record explicitly. A rejected record is never corrected, even from a form opened before it was rejected. |

### Reader submissions

When a reader saves a mapping for a sender the catalog does not recognise as approved (including when the catalog is unavailable), Readplace submits the FROM address only, as a `SubmitNewsletterSender` command. The `newsletter-catalog-suggestions` Lambda adds it as a `pending` record with `user-submission` evidence when the address is absent. It never renames an existing record and never reopens a rejected one; a repeated submission reports `already-present`. Nothing else about the reader, their mailbox or their readlist is sent.

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
