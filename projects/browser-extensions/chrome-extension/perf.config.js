// Measured, not chosen. 150ms is ~2.8x the slowest run mean over 20
// independent github-hosted runs (52.9ms), which is ~17 standard deviations of
// run-to-run spread above the average one; a real CI run measures ~49ms. Small
// enough that the regression this suite exists for — a save that walks the
// queue, ~12x the cost — cannot hide under it. Re-derive with the perf soak
// workflow when the runner image, the browser, or the save path moves.
module.exports = {
  meanSaveMs: 150,

  // The gate is the mean of this many warm saves. Twenty keeps the standard
  // error under a millisecond and is what the soak's budget was derived from,
  // so lowering it widens the spread the budget has to clear.
  gatedSaves: 20,

  // Reported, never gated: the first saves after a browser launch carry
  // extension start-up and an entry point no ETag has been issued for yet.
  warmupSaves: 2,
};
