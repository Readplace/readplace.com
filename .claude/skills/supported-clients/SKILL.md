---
name: supported-clients
description: How to add, remove, or edit a Readplace client (browser extension, native app, AI assistant) or its per-client data. Use when the set of supported clients changes — "add an Android app", "ship a Safari extension", "add Perplexity", "remove a client" — or when editing a client's display name, group, store URL, or OAuth identity.
---

# Changing the Supported Clients

The single source of truth is the workspace package `@packages/supported-clients`. Every consumer keys its per-client data off unions derived from that registry, so the compiler — not this document — knows every place that must change. Do not look for a checklist of consumer files here; it would rot. Follow the errors.

## Procedure

1. Read the registry source in the package to learn the entry shape and its discriminated unions (install source, auth identity), then add, remove, or edit the entry.
2. Sweep: `pnpm nx run-many -t compile --all --parallel=8`. Fix only what the errors name, then sweep again — repeat until exit 0.
   - Errors arrive in waves by dependency level: nx skips dependents of a failing project, so fixing one wave releases the next.
   - TypeScript reports excess keys in the same object literal one at a time; a clean sweep is the only "done" signal.
3. Run `pnpm check`. The remaining test failures are intentionality gates (the package's own roster snapshot, ordered-tab literals, copy pins, doc-sync tests) — update each deliberately; never delete a gate to go green.
4. Grep the repo for the client's slug and display name to find what no tool forces: prose (blog posts, legal copy), user-agent sniffing branches, and per-client build/release plumbing.

## Rules that keep the forcing alive

- Consumer maps stay in-place object literals under `satisfies Record<...>` — a spread, builder function, `Partial`, or index signature silently disables both the add and the remove checks.
- Exhaustive switches over registry unions need an explicit return type that excludes `undefined` (`noImplicitReturns` is not set in this repo).
- The auth-identity kind decides the OAuth work: a built-in client (fixed id shipped in a binary) is registered wherever the compiler demands it; a dynamically-registered client self-registers at runtime and must NOT be given a server-side identity.
- Wire values (OAuth client ids, store URLs) are shipped contracts: data, never derived from the client's slug, never renamed.
