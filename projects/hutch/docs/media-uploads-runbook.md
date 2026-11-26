# Media uploads runbook

## Withdrawing an upload kind

Video uploads were released on 2026-11-10. A kind is withdrawn by removing it from the upload page's kinds list and deploying. The same list withdraws audio.

- New uploads of that kind are then refused with `upload_unsupported_type`.
- Items already saved keep working: playback, transcripts and removal are not gated by the list.
- Also withdraw the public claims the release added: the help page's video line, the video line in `llms.txt` and `llms-full.txt`, the Readwise comparison's "Video files" row, and the privacy page's video wording. The "+ Article" popover offers the kinds it is given directly, so take video out of its list too.
