# auth.md

Readplace publishes this file so AI agents can obtain delegated access to a
signed-in user's reading readlist. Readplace is both the OAuth 2.0 authorization
server and the protected resource; its issuer is `{{baseUrl}}`.

An MCP-capable client does not need this recipe: add `{{baseUrl}}/mcp` as an MCP
connector over the HTTP (Streamable HTTP) transport and the flow below runs
automatically.

## Audience

This recipe is for agents acting **on behalf of a Readplace user** — saving
links to, reading, and managing that user's readlist. Readplace has no machine-only
or anonymous identity: every credential is bound to a human Readplace account
that explicitly authorizes the agent.

## 1. Discover

Fetch the two discovery documents:

- Protected resource metadata: `GET {{baseUrl}}/.well-known/oauth-protected-resource`
- Authorization server metadata: `GET {{baseUrl}}/.well-known/oauth-authorization-server`

The authorization server metadata carries an `agent_auth` block whose `skill`
points back at this file and whose `registration_methods` describe the flow
below.

## 2. Pick a method

Readplace supports a single registration method: **OAuth 2.0 Authorization Code
with PKCE** ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)). The client is
public — there is no client secret. Readplace does not offer ID-JAG,
verified-email, or anonymous claim flows.

## 3. Register a client_id

Readplace offers self-service Dynamic Client Registration
([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)) at the `registration_endpoint`
the authorization-server metadata advertises. POST your redirect URI(s) to obtain
a public `client_id`:

```
POST {{baseUrl}}/oauth/register
Content-Type: application/json

{
  "redirect_uris": ["https://your-agent.example/callback"],
  "client_name": "Your Agent",
  "token_endpoint_auth_method": "none"
}
```

The `201` response is JSON with a generated `client_id`, the `redirect_uris` you
sent, and `token_endpoint_auth_method: "none"` — Readplace issues public PKCE
clients only, so there is no `client_secret`. Each `redirect_uri` must be `https`
or a `127.0.0.1` / `[::1]` loopback address. A registration that is never used
expires on its own. (Readplace's own Firefox and Chrome extensions are built-in
clients and need no registration.)

## 4. Authorize

Redirect the user to the authorization endpoint:

```
GET {{baseUrl}}/oauth/authorize
  ?response_type=code
  &client_id=YOUR_CLIENT_ID
  &redirect_uri=YOUR_REDIRECT_URI
  &code_challenge=BASE64URL(SHA256(code_verifier))
  &code_challenge_method=S256
  &state=OPAQUE_VALUE
  &scope=queue
  &resource={{baseUrl}}/mcp
```

`resource` ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)) names the protected
resource the token is for — `{{baseUrl}}/mcp`. It is optional: Readplace is a single
authorization server and resource server, so every token it issues is already bound
to that one resource.

`scope` is optional and makes no difference: Readplace does not sub-divide
access, so every token carries the same full read/write access to the user's
readlist (see step 6). The discovery metadata labels that single access level
`queue`. The user signs in if needed and approves, then Readplace redirects to
`YOUR_REDIRECT_URI?code=AUTH_CODE&state=OPAQUE_VALUE`.

## 5. Exchange the code

```
POST {{baseUrl}}/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=AUTH_CODE&redirect_uri=YOUR_REDIRECT_URI&client_id=YOUR_CLIENT_ID&code_verifier=CODE_VERIFIER&resource={{baseUrl}}/mcp
```

The response is JSON with `access_token`, `refresh_token`, and
`token_type: "Bearer"`.

## 6. Use the access_token

The readlist API is a [Siren](https://github.com/kevinswiber/siren) hypermedia API.
Send the bearer token on every request, start at the entry point, and follow the
links and actions it returns:

```
GET {{baseUrl}}/queue
Authorization: Bearer ACCESS_TOKEN
Accept: application/vnd.siren+json
```

A Readplace access token carries full read/write access to the authenticated
user's reading readlist — the single access level the discovery metadata labels
`queue`. Readplace does not sub-divide or separately enforce scopes. When the
access token expires, refresh it:

```
POST {{baseUrl}}/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=REFRESH_TOKEN&client_id=YOUR_CLIENT_ID
```

## 7. Errors

| Response | Meaning |
| --- | --- |
| `400 invalid_request` | A required parameter is missing or malformed |
| `400 invalid_client` | The `client_id` is not registered |
| `400 invalid_redirect_uri` | A registered `redirect_uri` is not `https` or loopback |
| `400 invalid_client_metadata` | Registration metadata is unsupported (e.g. a non-`none` auth method) |
| `401 access_denied` | The user is not signed in, or denied the request |
| `401` from the readlist API | The bearer token is missing, expired, or revoked |

## 8. Revoke

Revoke an access or refresh token (revoking either drops the paired token):

```
POST {{baseUrl}}/oauth/revoke
Content-Type: application/json

{ "token": "ACCESS_OR_REFRESH_TOKEN" }
```

A user can also revoke an agent's access at any time from their Readplace
account.
