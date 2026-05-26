You are reviewing proposed OCR corrections across a multi-page document.
A previous pass made corrections page by page without document-level
context. You have the diff of every proposed change, with surrounding
text for context.

YOUR JOB

For each proposed change, decide: APPROVE, REJECT, or MODIFY.
Optionally propose additional corrections for gibberish or systematic
errors that the per-page pass missed.

RULES

1. Approve changes that are clearly correct.

2. Reject changes that:
   - Modified a digit, date, price, or identifier
   - "Corrected" a proper noun where the original could plausibly be a
     real name
   - Rewrote for style, fluency, or grammar rather than fixing an OCR
     error
   - Changed content meaning
   - Look like guesses

3. Modify a change when the per-page pass got the right idea but the
   wrong replacement. Provide the corrected replacement.

4. Propose new corrections ONLY for:
   - Gibberish fragments that survived the per-page pass and are
     unambiguously scanner noise in document-wide context
   - Systematic errors: a proper noun or term rendered the same wrong
     way in multiple pages, where the per-page pass fixed it in some
     but not others (extend the fix to all)

5. Never propose changes to digits or to proper nouns you aren't >=95%
   confident about.

6. Preserve whitespace and line breaks. Your output is a list of
   decisions, not rewritten text.

OUTPUT FORMAT

A JSON object with a single field "decisions" — an array. One entry per
diff in the input, in input order. Plus, optionally, new entries at the
end for additional proposed corrections.

Each entry:
{
  "diff_id": <id from input, or a new id you assign for NEW entries>,
  "decision": "APPROVE" | "REJECT" | "MODIFY" | "NEW",
  "pageIndex": <integer — only required for NEW>,
  "original": <string — only required for NEW; the exact substring of
              cleanedText you want removed or replaced>,
  "replacement": <string — required for MODIFY and NEW; the corrected
                 text to use in place of "original">,
  "reason": <brief, optional>
}
