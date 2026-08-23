# OCR language fixtures

One scanned-looking PDF per writing system the runtime routes to, plus
`expected-text.json` holding the lines each was rendered from.

**These files are the test contract. Do not regenerate them in place.** They
were produced from a headless browser, macOS `sips` and whatever fonts that
machine had installed, so the byte output is not reproducible: a different
browser version or font set yields a different page, and the overlap floors in
the test beside them were measured against *these* bytes. Re-rendering an
existing fixture silently changes what the test asserts.

## Adding a writing system

A pack belongs in the runtime allowlist once a new fixture proves two things,
in this order:

1. **The detector names the script.** Several scripts fail here and cannot be
   supported at all: the detector answers with a different script rather than
   declining, so the page routes to a real model and returns plausible noise.
2. **Recognition clears the overlap floor** in `language-support.integration.ts`.

Two fixture properties are load-bearing, and both were learned by getting them
wrong:

- **Running sentences, not a glyph table.** A first version listed each
  alphabet as isolated characters. Arabic, Bengali and Kannada all failed
  detection on it and passed on the same text as sentences, because the
  detector reads connected script and separated glyphs give it nothing.
- **Degraded, but not past the cliff.** The pipeline exists for scans, so clean
  type would not exercise the real condition. These sit at 250 dpi, JPEG
  quality 72, rotated 0.35 degrees. At 200 dpi and quality 55 the Bengali and
  Kannada pages lost their script again.
