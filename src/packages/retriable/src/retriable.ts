import assert from 'node:assert'

interface RetriableConfig<TArgs extends unknown[], TResult> {
  maxAttempts: number
  retryDelayMs: number
  shouldRetry: (result: TResult) => boolean
  beforeRetry?: (...args: TArgs) => Promise<void> | void
}

export function retriable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: RetriableConfig<TArgs, TResult>,
): (...args: TArgs) => Promise<TResult> {
  assert(
    Number.isInteger(config.maxAttempts) && config.maxAttempts > 0,
    'maxAttempts must be a positive integer',
  )

  return async (...args: TArgs): Promise<TResult> => {
    let lastResult: TResult | undefined

    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
      lastResult = await fn(...args)

      if (!config.shouldRetry(lastResult)) {
        return lastResult
      }

      const hasMoreAttempts = attempt < config.maxAttempts - 1
      if (hasMoreAttempts) {
        await new Promise(resolve => setTimeout(resolve, config.retryDelayMs))
        if (config.beforeRetry) {
          await config.beforeRetry(...args)
        }
      }
    }

    assert(lastResult !== undefined, 'lastResult should be defined after at least one attempt')
    return lastResult
  }
}
