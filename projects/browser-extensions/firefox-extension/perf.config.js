// Measured, not chosen. Re-derive with the perf soak workflow when the runner
// image, the browser, or the save path moves.
module.exports = {
  popupOpenMs: 106,
  popupOpenSamples: 3,
  popupRuntimeHoldMs: 1000,
  meanSaveMs: 190,

  // The gate is the mean of this many warm saves. Twenty is what the soak's
  // budget was derived from, so lowering it widens the spread the budget has to
  // clear.
  gatedSaves: 20,

  // Reported, never gated: the first saves after a browser launch carry
  // extension start-up and an entry point no ETag has been issued for yet.
  warmupSaves: 2,

  // Measured, not chosen. Re-derive with the perf soak workflow when the runner
  // image, the browser, or the save path moves.
  meanSaveAllMs: 1200,

  tabsPerSaveAll: 100,
  gatedSaveAlls: 5,
  warmupSaveAlls: 1,
};
