# BPMN renderings of the architecture snapshots

Each snapshot under `.architecture/` documents a flow in **event-storming**
notation (Command → System → Event), authored as Mermaid `flowchart` blocks and
pre-rendered to SVG in its `diagrams/` folder.

This tool re-expresses every one of those diagrams in **BPMN** (Business Process
Model and Notation). For each Mermaid block it writes, into a sibling
`diagrams-bpmn/` folder next to the snapshot's `diagrams/`:

- `<name>.png` — a BPMN-notation rendering (the deliverable image).
- `<name>.bpmn` — valid **BPMN 2.0 XML** with layout, openable/editable in
  [bpmn.io](https://demo.bpmn.io), the Camunda Modeler, or any BPMN tool.

The PNG keeps the event-storming colour palette so the two representations line
up at a glance; the BPMN *shape* of each node is what changes.

## Event-storming → BPMN mapping

| Event-storming role | Colour | BPMN element | Drawn as |
|---|---|---|---|
| Command (`command`/`cmd`) | blue | Send Task | rounded rectangle, ✉ marker |
| System / Aggregate (`system`/`sys`) | yellow | Service Task | rounded rectangle, ⚙ marker |
| Event (`event`/`evt`) | orange | Start / Intermediate-Throw / End **message event** | circle, ✉ icon (start = no incoming, end = no outgoing) |
| Policy / Reaction (`policy`/`pol`) | purple | Business Rule Task, or End Event when terminal | rounded rectangle (table marker) / thick circle |
| Read model / Store (`store`/`read`) | green | Data Store Reference | cylinder, joined by a dashed data association |
| Queue (`queue`) | grey | Intermediate Catch **message event** | double circle, ✉ icon |
| DLQ (`dlq`) | red | **Error** End Event | thick circle, error bolt |
| UI / actor (`ui`) | white | Start message event, or User Task when it also receives | circle / rounded rectangle (person marker) |
| Decision (`{…}`) | — | Exclusive Gateway | diamond, × marker |
| New-in-snapshot (`new`) | gold | shape inferred from the Mermaid node shape, drawn with a gold accent | — |

Edges become **sequence flows** (solid arrow); dashed Mermaid edges (`-.->`,
e.g. "on failure", "publish") stay dashed; any edge touching a data store is an
**association** (dashed, store colour). `subgraph` groupings are drawn as BPMN
groups (dashed rounded boxes).

> The `new` highlight class in the source colours a node gold to flag it as new
> in that snapshot — it overrides the role colour exactly as the original
> Mermaid render does, so the BPMN role for those nodes is inferred from the
> Mermaid node shape (cylinder → store/queue/DLQ, rectangle → task, etc.).

## Regenerating

The renderer is browserless — it emits SVG directly and rasterises with
[`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) (no Chromium needed,
unlike the Mermaid CLI). It is **not** wired into the workspace; install its one
dependency on demand:

```bash
cd .architecture/tools/bpmn
npm install @resvg/resvg-js
node generate-bpmn.mjs                       # (re)write every diagrams-bpmn/ folder
node generate-bpmn.mjs debug 2026-05-30 flow # render matches to /tmp/out for inspection
```

System fonts under `/usr/share/fonts` (DejaVu Sans / Liberation Sans) are used
for text. The generated `.bpmn` files parse cleanly under `bpmn-moddle` (the
bpmn.io model layer), i.e. they are well-formed BPMN 2.0, not just look-alikes.

## Files

| File | Responsibility |
|---|---|
| `parse.mjs` | Tolerant Mermaid `flowchart` parser (nodes, edges, classes, subgraphs). |
| `render.mjs` | Role → BPMN element mapping and layered (Sugiyama-style) layout. |
| `draw.mjs` | SVG drawing of BPMN shapes, markers and routed edges. |
| `bpmn.mjs` | BPMN 2.0 XML (`.bpmn`) emission, reusing the same layout coordinates. |
| `generate-bpmn.mjs` | Entry point: walk snapshots, write `.png` + `.bpmn`. |
