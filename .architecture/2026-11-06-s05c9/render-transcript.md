# A finished transcription job becomes the audio item's transcript

Snapshot of the uncommitted working tree over `b56db4115`, a local series on `main`. Generated 2026-11-06.

The media-audio deployable gains a subscriber to Amazon Transcribe's job state changes. No charged upload is published yet, so no `rp-` job runs and the new Lambda receives nothing until the charge fields arrive.

- **`media-audio-render-transcript` rule, queue and Lambda.** An EventBridge rule on the default bus matches `Transcribe Job State Change` for jobs named `rp-…` that ended `COMPLETED` or `FAILED`, and feeds its own queue (two receives before the shared media-audio dead-letter queue). The zip Lambda (1024 MB, 120 s) handles one record at a time.
- **Release check first.** With the job request gone it deletes the attempt's files. With the item gone or released it settles the charge, then deletes the files.
- **COMPLETED.** It reads Transcribe's output, renders paragraphs with seek links and a timestamp heading every five minutes, writes a tier-0 source (site name "Audio", read time from the duration), publishes `TierContentExtracted` and settles the charge. A transcript with no words writes the short audio body instead, then settles.
- **FAILED.** It writes the short audio body and leaves the charge alone.
- **Dead-letter route.** The failures router gains a render-transcript route: after the same release check it writes the short body so the item stays playable, then settles.

---

## Legend

Amber marks what this change adds. Everything else is existing infrastructure shown for context.

![Legend](diagrams/legend.svg)

[BPMN image](diagrams-bpmn/legend.png) · [Editable BPMN](diagrams-bpmn/legend.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef queue   fill:#d9d9d9,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    S["System / aggregate"]:::system
    E(("Event")):::event
    Q[["Queue"]]:::queue
    N(("Added by this change")):::new
```

</details>

---

## Render transcript

![Render transcript](diagrams/render-transcript.svg)

[BPMN image](diagrams-bpmn/render-transcript.png) · [Editable BPMN](diagrams-bpmn/render-transcript.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef queue   fill:#d9d9d9,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    J(("Transcribe Job State Change, rp- job")):::event
    J --> Q[["media-audio-render-transcript-q"]]:::new
    Q --> R["Render transcript"]:::new
    R -- "job request gone" --> X["Delete the attempt's files"]:::new
    R -- "item released" --> S["Settle the charge"]:::new
    S --> X
    R -- "COMPLETED" --> T(("TierContentExtracted, tier-0 transcript")):::event
    R -- "FAILED or no words" --> B(("TierContentExtracted, short audio body")):::event
    T --> S2["Settle the charge"]:::new
    Q -. "after 2 receives" .-> D[["media-audio-failures DLQ"]]:::queue
    D --> DR["Render-transcript dead-letter route"]:::new
    DR --> B
```

</details>

---

## Command → System → Event(s) reference

| Command or event | Detail | System | Emits | Triggers next |
|---|---|---|---|---|
| `Transcribe Job State Change` | `COMPLETED` or `FAILED`, job name `rp-<uploadId>-<attempt>` | render-transcript | `TierContentExtracted` with the transcript, or the short audio body | content selection, which serves the transcript as first content |
| render-transcript dead letter | the job state change | media-audio failures router | `TierContentExtracted` with the short audio body | none |
