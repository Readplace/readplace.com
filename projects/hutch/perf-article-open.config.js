// Sample counts for the article-open harness, which reports a distribution
// rather than gating a budget: no soak has been run for this path, so there is
// no measured number a threshold could be derived from, and a chosen one would
// be exactly the unmeasured claim the harness exists to test.
module.exports = {
  // 20 gated samples is what the extension save budget was derived from, and it
  // is the smallest count that keeps the standard error of a ~150ms mean under
  // a few milliseconds — small enough to read a difference of that size as
  // signal rather than spread.
  measuredSamplesPerCondition: 20,

  // Reported, never counted: the first opens after a condition's throttling is
  // applied carry a cold HTTP connection to the server and a stylesheet the
  // reader has not laid out yet. Three, because the article body is fetched,
  // parsed and laid out on the first open and cached from the second.
  warmupsPerCondition: 3,
};
