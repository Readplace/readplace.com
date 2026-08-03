// This suite has no clock: it charges a fixed round trip against a counter and
// asserts every sample comes back identical, so the budget is not a safety
// margin. 400ms is one simulated round trip above the costliest scenario — a
// cold background boot, at 3 round trips — so a save that grows by a single
// request fails it. Tightening to 300 forbids any growth on the cold path.
module.exports = {
  meanSaveMs: 400,

  // What one request costs on a hostile network. The budget is denominated in
  // these, so moving it rescales every scenario: at 100ms a save may spend 4
  // round trips, at 50ms it may spend 8.
  roundTripMs: 100,

  // Repeats per scenario. The suite asserts they come back identical, so this
  // buys proof of determinism rather than statistical confidence.
  samplesPerScenario: 3,

  // A bulk save spends one entry point walk plus one request per full manifest,
  // so a hundred tabs at the server's twenty-page cap costs 6 round trips —
  // 600ms. 700 is one round trip above that: a bulk save that grows by a single
  // request fails, and today's chunking has no slack to hide in.
  meanSaveAllMs: 700,

  tabsPerSaveAll: 100,
};
