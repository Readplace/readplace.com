// Measured, not chosen. 110ms is ~2.1x the slowest run mean over 20
// independent github-hosted runs (52.9ms), which is ~10 standard deviations of
// run-to-run spread above the average one; a real CI run measures ~49ms. None
// of those 20 runs comes within 57ms of it, and Chrome showed no tail worth
// pricing in — its worst single sample was 65.9ms, so a run made entirely of
// worst-case saves would still pass. Re-derive with the perf soak workflow
// when the runner image, the browser, or the save path moves.
module.exports = {
  meanSaveMs: 110,

  // The gate is the mean of this many warm saves. Twenty keeps the standard
  // error under a millisecond and is what the soak's budget was derived from,
  // so lowering it widens the spread the budget has to clear.
  gatedSaves: 20,

  // Reported, never gated: the first saves after a browser launch carry
  // extension start-up and an entry point no ETag has been issued for yet.
  warmupSaves: 2,

  // Measured, not chosen. 2000ms is ~2.0x the slowest run mean over 20
  // independent github-hosted runs (1012ms), which is ~16 standard deviations of
  // run-to-run spread above the average one; a real CI run measures ~888ms. A
  // hundred tabs cost ~19x one save because the flow captures every tab before
  // its first request leaves. The tail is shallow — the worst single sample of
  // the 100 was 1145ms, so a run made entirely of worst-case saves would still
  // pass. Re-derive with the perf soak workflow when the runner image, the
  // browser, or the save path moves.
  meanSaveAllMs: 2000,

  tabsPerSaveAll: 100,
  gatedSaveAlls: 5,
  warmupSaveAlls: 1,
};
