# DNS for AI Discovery (DNS-AID)

[DNS-AID](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/)
publishes a domain's agent entrypoints in the `_agents` DNS namespace so an agent
can find them before making any HTTP request. The records advertise the same
surface the app already serves over HTTPS: the `.well-known/agent-skills` index,
the OAuth authorization-server / protected-resource metadata, and the
api-catalog.

## What is published

`buildDnsAidRecords` (`src/runtime/web/dns-aid.ts`) returns one ServiceMode SVCB
record ([RFC 9460](https://www.rfc-editor.org/rfc/rfc9460)) per apex; the
`AgentDiscoveryRecords` Pulumi component (`src/infra/agent-discovery-records.ts`)
writes them to Route 53. For each configured domain:

```
_index._agents.<domain>.  3600  IN  SVCB  1 <domain> alpn="h2" port=443
```

- **`_index`** is the general entrypoint. We do not publish the draft's `_a2a`
  example label — the app answers over HTTPS, not Agent2Agent JSON-RPC, so an
  `_a2a` target would never connect.
- **`alpn="h2"`** advertises HTTP/2. RFC 9460 §7.1.1 implies the https default
  (`http/1.1`); `h3` is omitted because the API Gateway custom domains fronting
  the apexes do not serve HTTP/3.
- The `mandatory` and `keyNNNNN` SvcParams from the draft are omitted because
  Route 53 rejects them.

Production publishes records for `readplace.com` and `hutch-app.com`. Staging
configures no apex domains, so no records are created there.

## Verifying after deploy

```sh
dig +short _index._agents.readplace.com SVCB
# 1 readplace.com. alpn="h2" port=443
```

Then confirm the external scanner sees them:

```sh
curl -s https://isitagentready.com/api/scan \
  -H 'content-type: application/json' \
  -d '{"url":"https://readplace.com"}' | jq '.checks.discoverability.dnsAid.status'
# "pass"
```

## DNSSEC (manual, change-controlled)

The draft asks that the discovery zone be DNSSEC-signed so validating resolvers
return authenticated data. This is **not** automated here, on purpose: an
incomplete or broken chain of trust returns SERVFAIL for the *entire apex* on
validating resolvers, and the final step lives at the registrar, outside Pulumi.
Enable it deliberately, one zone at a time, watching resolution between each
step.

1. **KMS key** — create a customer-managed asymmetric signing key in `us-east-1`
   (Route 53 DNSSEC requires that region), key spec `ECC_NIST_P256`, usage
   `SIGN_VERIFY`, with a key policy granting the `dnssec-route53.amazonaws.com`
   service principal `kms:DescribeKey`, `kms:GetPublicKey`, and `kms:Sign`.
2. **Key-signing key** — `aws.route53.KeySigningKey` referencing the hosted zone
   and the KMS key ARN, `status: "ACTIVE"`.
3. **Enable signing** — `aws.route53.HostedZoneDNSSEC` for the hosted zone, with
   `dependsOn` the KSK.
4. **Upload the DS record at the registrar.** Take the DS record Route 53
   generates for the KSK and add it to the parent zone via the domain registrar.
   Until this lands, the zone is signed but has no chain of trust — resolvers
   treat it as insecure, which is harmless but provides no authentication. A
   wrong DS is what causes SERVFAIL, so copy it exactly and verify with
   `dig +dnssec _index._agents.<domain> SVCB @1.1.1.1` (a validating resolver,
   expect the `ad` flag) before considering the zone done.

To roll back, remove the DS record at the registrar first, wait for its TTL to
expire everywhere, then disable `HostedZoneDNSSEC`. Disabling signing while the
DS record still points at the zone is the other way to SERVFAIL the domain.
