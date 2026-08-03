// Measured, not chosen. 190ms is ~2.0x the slowest run mean over 20
// independent github-hosted runs (93.6ms), which is ~8 standard deviations of
// run-to-run spread above the average one; a real CI run measures ~81ms.
// Firefox sits apart from Chrome because it measured 1.7x slower with 2.3x the
// spread and a real tail — its worst sample was 423ms against Chrome's 66 — so
// one budget covering both would have to clear Firefox and would then let a 5x
// Chrome regression through. That tail is what sets this number rather than
// the spread: a run drawing four worst-case samples among twenty still means
// 145ms. Re-derive with the perf soak workflow when the runner image, the
// browser, or the save path moves.
module.exports = {
  meanSaveMs: 190,

  // The gate is the mean of this many warm saves. Twenty keeps the standard
  // error under a millisecond and is what the soak's budget was derived from,
  // so lowering it widens the spread the budget has to clear.
  gatedSaves: 20,

  // Reported, never gated: the first saves after a browser launch carry
  // extension start-up and an entry point no ETag has been issued for yet.
  warmupSaves: 2,

  // Measured, not chosen. 1900ms is ~2.0x the slowest run mean over 20
  // independent github-hosted runs (938ms), which is ~10 standard deviations of
  // run-to-run spread above the average one; a real CI run measures ~705ms.
  // Firefox saves a hundred tabs faster than Chrome but with 1.7x the spread, so
  // this is set from the same multiple of its own slowest run rather than shared
  // with Chrome's. The worst single sample of the 100 was 1120ms, so a run made
  // entirely of worst-case saves would still pass. Re-derive with the perf soak
  // workflow when the runner image, the browser, or the save path moves.
  meanSaveAllMs: 1900,

  tabsPerSaveAll: 100,
  gatedSaveAlls: 5,
  warmupSaveAlls: 1,
};
