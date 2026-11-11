# Media uploads runbook

## Withdrawing an upload kind

Video uploads were released on 2026-11-10. To stop offering them, put `"video"` back in the upload page's list of kinds that only a `?features=transcripts` start may offer (grep the upload pages for `METERED_ONLY_UPLOAD_KINDS`) and deploy. The same list withdraws audio.

- New uploads of that kind are then refused with `upload_unsupported_type` unless the reader starts at `/upload?features=transcripts`.
- Items already saved keep working: playback, transcripts and removal are not gated by the list.
- Also withdraw the public claims the release added: the help page's video line, the video line in `llms.txt` and `llms-full.txt`, the Readwise comparison's "Video files" row, and the privacy page's video wording. The "+ Article" popover offers the kinds it is given directly, so take video out of its list too.
