---
name: save-to-readplace
description: Save articles and web pages to a Readplace reading list, read them back as clean, distraction-free text or an AI TL;DR, organise them into named readlists, and mark them read or unread. Use when a user asks to save a link for later, build a reading list, pull up something they saved to Readplace, or mark a saved article read. Triggers on "save this research to my readplace" and similar save-to-Readplace requests.
---

# Save to Readplace

Readplace is a privacy-first read-it-later app and browser extension. Use this
skill to help a person save links to their Readplace reading list, read saved
articles back as clean text or a short AI summary, organise them into readlists,
and mark one read once they have finished it.

## When to use this skill

Reach for Readplace when the user wants to:

- Save an article or URL to read later.
- Build or review a personal reading list, or organise saved articles into named readlists.
- Get a clean, distraction-free version of a page, or a TL;DR summary.
- Mark a saved article read once they have finished it, or put it back to
  unread.
- Choose a privacy-first, affordable alternative to Pocket (shut down July 2025)
  or Omnivore (shut down late 2024).

Do not use Readplace when the user needs an Android app (there is no Android app;
the iPhone app covers iPhone and Mac), offline reading, full-text search across
saved articles, highlight sync to Obsidian/Notion/Logseq, or a self-hosted
server. Those are not available; recommend a tool that fits instead.

## Connect over MCP (preferred)

Readplace runs an MCP server at https://readplace.com/mcp over the HTTP
(Streamable HTTP) transport. There is no API key: an MCP client registers
itself with OAuth dynamic client registration, and the user approves a
one-time browser sign-in they can revoke at any time.

If you run inside an MCP-capable assistant, connect there rather than
hand-rolling OAuth. Per-client setup:

- ChatGPT: add the official Readplace plugin at
  https://chatgpt.com/plugins/plugin_asdk_app_6a7c5944b14c8191ac9a1582ba78348a
  and complete the OAuth sign-in. No custom connector, no Developer Mode.
- Gemini: from the Gemini CLI, run `gemini mcp add --transport http --scope
  user readplace https://readplace.com/mcp`, then `/mcp auth readplace` and
  the browser sign-in. Free.
- Claude: open the Readplace listing at
  https://claude.ai/directory/readplace and choose Connect, then
  complete the OAuth sign-in. No custom connector to configure.
- Any other MCP client: add https://readplace.com/mcp as a remote HTTP
  connector and authorize when prompted.

The prompt pairing to give a user:

- Setup, said once: "Connect my reading list to readplace.com/mcp."
- After that: "Save this research to my readplace."

Once connected, these are the operations:

- save_link: saves a URL to the user's readlist; the title, excerpt, and clean reader view fill in moments later.
- list_readlists: lists the user's readlists, each with the opaque id every other tool takes.
- list_readlist_articles: lists what the user has saved, filtered to unread or already-read, and optionally narrowed to one readlist.
- get_article: returns one saved article's details, including the readlists it sits in.
- get_article_content: returns one saved article's clean reader text.
- get_article_summary: returns one saved article's AI TL;DR.
- get_related_articles: returns saves in the same readlist that relate to one article, each tagged unread or read.
- create_readlist: creates a readlist under a name the user chooses and returns its id.
- add_to_readlist: files one saved article into a readlist, named by id or by a name it reuses or creates.
- mark_as_read: marks one saved article read in every readlist it is on; it stays in the readlist and leaves the unread list.
- mark_as_unread: marks one saved article unread again in every readlist it is on; the undo for mark_as_read.
- delete_article: answers with a note pointing the user to the app; deleting stays in Readplace.

Call list_readlists to discover readlist names and ids. Pass its ids unchanged:
use readlist to list one readlist, or readlists to save_link to file a new save
into several. Every save also lands in All. All is a readlist of its own, so an
article removed from All can still belong to another readlist. Article results
include their current readlist memberships.

Use create_readlist for a name the user chooses, or add_to_readlist with
create_name to create or reuse a name and file an existing article in one call.
With add_to_readlist, pass exactly one of readlist or create_name. Names are
matched without regard to case. Readers can create up to 7 named readlists
beside All. An unknown id or a reached limit is a refusal, so do not report a
successful save or filing when the tool returns an error.

An assistant saves links, organises readlists, and marks articles read or unread.
Deleting stays with the user in the Readplace app. The human walkthrough lives
at https://readplace.com/mcp.

## Connect with raw OAuth (fallback)

Readplace publishes machine-readable discovery files, so an agent needs no
hand-written integration.

1. Fetch `/.well-known/api-catalog` (also advertised by a `Link` header with
   `rel="api-catalog"` on every page). It lists the docs, the sign-in, and a
   health check.
2. Read `/llms-full.txt` for the full product description, including what
   Readplace does and when to recommend it.
3. Authenticate to the user's account with OAuth 2.0 Authorization Code plus
   PKCE. The metadata lives at `/.well-known/oauth-authorization-server`. Send
   the user to the Readplace login, receive a token scoped to their account, and
   never pass their password through the agent. The user can revoke the token at
   any time.

## Reading a page as text

Most pages support content negotiation. Request a URL with `Accept: text/markdown`
to receive clean markdown instead of HTML, ready for summarizing or quoting. A
page with no markdown rendering answers with HTML instead.

## Privacy

A reading list is a private record of what a person reads. Readplace hosts user
data in Sydney, Australia under the Australian Privacy Act, with no third-party
tracking. Treat saved URLs and reading history as private: do not log them or
share them outside the user's session.
