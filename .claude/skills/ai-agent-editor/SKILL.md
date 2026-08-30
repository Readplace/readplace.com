---
name: ai-agent-editor
description: Guidelines for writing documentation that AI agents consume — skills, CLAUDE.md, README files. Use whenever a file under .claude/skills/ is created or changed, however small the edit, and when editing CLAUDE.md or a README written for agents. Every skill edit is checked against these rules before it ships.
---

# AI Agent Editor Guidelines

Conventions for documentation that AI agents consume. Two goals: spend as little of the context window as possible, and stay true when the code changes.

## Every skill edit triggers this skill

Any change to a file under `.claude/skills/` — a new skill, a reworded sentence, an added example — applies these guidelines to the whole file being edited, not only to the lines that changed. A skill edit that names code (see the next section) is not finished.

## Core Principle: Discoverability Over Duplication

AI agents can inspect the codebase. Guide the agent to discover information rather than duplicating it inline.

## Describe Code by Its Role, Never by Its Name

A skill names no real file path, directory, module, exported symbol, function, class, CSS class, package, nx project name or test id. Nothing compiles or tests prose, so a rename leaves the skill pointing at code that no longer exists and the agent reading it none the wiser. A product rename moved a page directory and an E2E suite, and two skills went on citing the old files until a later audit noticed.

Say what the thing *is*, and when the agent must open it, say how to *find* it from something that survives a rename:

| Anchor | Example |
|---|---|
| A behaviour or distinctive string the code must contain | "the handler that writes the `HX-Retarget` header — grep for it" |
| A command that lists it | `pnpm nx show projects`, `pnpm run`, `ls` |
| A contract that names it | a route, a query parameter, an event name, a config key, an nx target |

```markdown
<!-- ❌ BAD - a path and a symbol, both gone at the next rename -->
See `pages/listing/listing.page.ts` (`respondRowSwap`).

<!-- ✅ GOOD - the role, plus a rename-proof way to find it -->
See the listing page's row-swap handler — the one that answers with the
`HX-Retarget` header when the DOM has drifted.
```

```markdown
<!-- ❌ BAD - a filename -->
Local suites import `test` from `hermetic-fixture.ts`.

<!-- ✅ GOOD - the role -->
Local suites import `test` from the hermetic fixture — the module that
answers third-party asset requests from pinned local files instead of the
network; grep for the request-fulfilment call.
```

What a skill may still name, because these are contracts or documents rather than code identifiers, and changing one is a deliberate published change:

- wire values: URLs and routes, query parameters, headers, event names, database attribute names, config keys, environment variables
- commands, scripts and nx targets
- external tools, specifications and services
- Pulumi project and stack names — pinned in deployed state and StackReferences
- other documentation files — CLAUDE.md, the brand guidelines, another skill — linked by path

A frontmatter `description` may quote strings the agent will literally see on screen — an error message, a command, a URL — because those are what it matches against. It does not name source symbols.

## Reference Code, Don't Duplicate It

```markdown
<!-- ❌ BAD - Duplicates code -->
type PageComponent = { head: HeadComponent; ... }

<!-- ✅ GOOD - Points at the role -->
The page component type lives beside the SSR renderer; read it rather than
restating its shape here.
```

## Reference Commands, Don't Explain Them

```markdown
<!-- ❌ BAD -->
We execute e2e tests using `pnpm nx run flights:test-ui`...

<!-- ✅ GOOD -->
Inspect `project.json` to understand how e2e tests run.
```

## Document Why, Not What

```markdown
<!-- ❌ BAD -->
The booking ID uses a 31-character set and weighted sum algorithm...

<!-- ✅ GOOD -->
The booking ID excludes 0, O, 1, I, L to avoid confusion when read over the
phone. The generator is the one function in the domain layer that mints
booking IDs.
```

## When to Include Code Examples

Include inline code examples only when:

1. **Pattern contrast** - Good vs bad approaches requiring side-by-side comparison
2. **Conceptual patterns** - Abstract patterns not tied to specific files
3. **New patterns** - Code that doesn't exist in the codebase yet

Examples use an invented domain — the skills here use flights and bookings — and never borrow a name from the real codebase. A reader must not be able to mistake an example for a reference, and a rename must not be able to invalidate one.

## Structure Guidelines

| Guideline | Rationale |
|-----------|-----------|
| Use concise headings | Scannable navigation |
| Prefer tables over prose | More scannable, less context |
| Link to external specs | Don't re-document standards |

## Anti-Patterns

| Avoid | Reason |
|-------|--------|
| Real file paths, symbols, class names | Rot on rename and nothing catches it; describe the role and how to find it |
| Directory structure diagrams | Stale when files change; use `ls` |
| Command output examples | Stale with versions; just run the command |
| ASCII workflow diagrams | Hard to maintain; use prose or link externally |

## Before a Skill Edit Ships

1. Grep the whole skill for `.ts`, `.js`, `.css`, `.html`, `.swift`, `.kt`, `/src/`, `projects/`, `@packages/`, BEM tokens (`__`, `--`) and backticked camelCase or PascalCase words. Every hit is a wire value, a command, a documentation link, an invented example — or a reference that has to become a role description.
2. Run every discovery procedure the skill gives (each "grep for", each listing command) and confirm it finds exactly the thing meant, and only that.
3. Read the skill's frontmatter `description`: it names the situations that trigger the skill in words the agent will meet, not source symbols.

## Self-Application

These guidelines apply to this skill itself. When updating ai-agent-editor:

1. Keep examples minimal and focused on pattern contrast
2. Reference this skill's own principles rather than restating them
3. Delete guidelines that duplicate what can be discovered from other skills
