# Admin MFA runbook

Every `/admin` page asks an admin for an authenticator code. A session reaches an admin page only when its user is listed in `ADMIN_EMAILS` and that session entered a valid time-based code at `/admin/mfa` within the last 12 hours. The code is checked against a secret held for that admin in `ADMIN_TOTP_SECRETS`. The recrawl service token (`x-service-token`) is unaffected: it still reaches the routes it reached before, with no code.

## The `ADMIN_TOTP_SECRETS` value

A comma-separated list of `<admin email>=<secret>` entries, where the secret is exactly 40 lower-case hex characters (20 bytes). Spaces around an entry and the letter case of the address do not matter. Hold one secret per admin per stack: staging and production each have their own GitHub environment secret.

The deploy reads the value, checks it, and copies it into the `SecureString` SSM parameter `/readplace/admin-totp-secrets`. The web function reads that parameter when a code is submitted. Nobody edits the parameter by hand; the next deploy overwrites it.

- A malformed value fails the deploy before anything changes. The error names the position of the bad entry (`ADMIN_TOTP_SECRETS entry 2 ...`) and never prints the value.
- An admin listed in `ADMIN_EMAILS` with no entry in `ADMIN_TOTP_SECRETS` is refused at the challenge: every code they enter is rejected.

Adding an admin therefore needs both `ADMIN_EMAILS` and `ADMIN_TOTP_SECRETS`, with the same address in each.

## Enrolling an admin

1. Draw a secret. This prints the hex form on the first line and the base32 form on the second, both from the same 20 random bytes:

   ```bash
   python3 -c "import os,base64; b=os.urandom(20); print(b.hex()); print(base64.b32encode(b).decode())"
   ```

2. Enter the base32 form in the admin's authenticator app as a time-based key: 6 digits, SHA-1, 30-second period.

3. Confirm the authenticator agrees. Paste the hex form on standard input, so it stays out of the shell history; the command prints the current code, which must match the one the app shows. If they differ, the two forms were not copied from the same draw, and no code will ever validate:

   ```bash
   python3 -c "import hmac,hashlib,struct,time,sys; k=bytes.fromhex(sys.stdin.readline().strip()); h=hmac.new(k,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest(); o=h[-1]&15; print(str((struct.unpack('>I',h[o:o+4])[0]&0x7fffffff)%1000000).zfill(6))"
   ```

4. Add `<admin email>=<hex form>` to the stack's `ADMIN_TOTP_SECRETS` environment secret and deploy.

GitHub never returns a secret's value, so changing one entry means setting the whole value again. An admin whose hex form was not kept is enrolled again from step 1.

## A lost device

Enrol the admin again: draw a new secret, replace that admin's entry in `ADMIN_TOTP_SECRETS`, and redeploy. The old secret stops working once the deploy finishes; a session that already passed the challenge keeps its access until its 12 hours run out.

## Running `/admin` locally

The local server reads `ADMIN_TOTP_SECRETS` from the environment. Put an entry for the address in your local `ADMIN_EMAILS` into the gitignored `.env`, enrolled as above, to open a local `/admin`.
