// Re-derive with the perf soak workflow when the runner image, the browser, or
// the save path moves.
module.exports = {
  meanSaveMs: 110,

  // The gate is the mean of this many warm saves. Twenty is what the soak's
  // budget was derived from, so lowering it widens the spread the budget has to
  // clear.
  gatedSaves: 20,

  // Reported, never gated: the first saves after a browser launch carry
  // extension start-up and an entry point no ETag has been issued for yet.
  warmupSaves: 2,

  // Re-derive with the perf soak workflow when the runner image, the browser,
  // or the save path moves.
  meanSaveAllMs: 2000,

  tabsPerSaveAll: 100,
  gatedSaveAlls: 5,
  warmupSaveAlls: 1,
  popupOpenMs: 107,
  popupOpenSamples: 3,
  popupRuntimeHoldMs: 1000,
};
