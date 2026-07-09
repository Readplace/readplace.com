import { retriable } from './retriable'

describe('retriable', () => {
  describe('constructor validation', () => {
    it('throws when maxAttempts is 0', () => {
      expect(() =>
        retriable(async () => 'ok', {
          maxAttempts: 0,
          retryDelayMs: 0,
          shouldRetry: () => false,
        }),
      ).toThrow('maxAttempts must be a positive integer')
    })

    it('throws when maxAttempts is negative', () => {
      expect(() =>
        retriable(async () => 'ok', {
          maxAttempts: -1,
          retryDelayMs: 0,
          shouldRetry: () => false,
        }),
      ).toThrow('maxAttempts must be a positive integer')
    })

    it('throws when maxAttempts is not an integer', () => {
      expect(() =>
        retriable(async () => 'ok', {
          maxAttempts: 2.5,
          retryDelayMs: 0,
          shouldRetry: () => false,
        }),
      ).toThrow('maxAttempts must be a positive integer')
    })
  })

  describe('success on first attempt', () => {
    it('returns result when shouldRetry is false', async () => {
      const fetchItems = async () => ['a', 'b', 'c']

      const result = await retriable(fetchItems, {
        maxAttempts: 3,
        retryDelayMs: 0,
        shouldRetry: () => false,
      })()

      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('calls the operation exactly once', async () => {
      let callCount = 0
      const fetchItems = async () => {
        callCount++
        return ['item']
      }

      await retriable(fetchItems, {
        maxAttempts: 3,
        retryDelayMs: 0,
        shouldRetry: () => false,
      })()

      expect(callCount).toBe(1)
    })
  })

  describe('retry behavior', () => {
    it('retries until shouldRetry returns false', async () => {
      let callCount = 0
      const fetchItems = async () => {
        callCount++
        return callCount >= 3 ? ['a', 'b'] : ['a']
      }

      const result = await retriable(fetchItems, {
        maxAttempts: 5,
        retryDelayMs: 0,
        shouldRetry: (items) => items.length < 2,
      })()

      expect(result).toEqual(['a', 'b'])
      expect(callCount).toBe(3)
    })

    it('returns last result when all attempts exhausted', async () => {
      const fetchItems = async () => ['incomplete']

      const result = await retriable(fetchItems, {
        maxAttempts: 3,
        retryDelayMs: 0,
        shouldRetry: () => true,
      })()

      expect(result).toEqual(['incomplete'])
    })

    it('calls operation exactly maxAttempts times when always retrying', async () => {
      let callCount = 0
      const fetchItems = async () => {
        callCount++
        return []
      }

      await retriable(fetchItems, {
        maxAttempts: 4,
        retryDelayMs: 0,
        shouldRetry: () => true,
      })()

      expect(callCount).toBe(4)
    })
  })

  describe('beforeRetry callback', () => {
    it('calls beforeRetry between attempts with original args', async () => {
      const beforeRetryArgs: string[] = []
      let callCount = 0
      const fetchItems = async (label: string) => {
        callCount++
        return callCount >= 2 ? [label] : []
      }

      await retriable(fetchItems, {
        maxAttempts: 3,
        retryDelayMs: 0,
        shouldRetry: (items) => items.length === 0,
        beforeRetry: async (label) => { beforeRetryArgs.push(label) },
      })('test-arg')

      expect(beforeRetryArgs).toEqual(['test-arg'])
    })

    it('does not call beforeRetry after last attempt', async () => {
      let beforeRetryCount = 0
      const fetchItems = async () => []

      await retriable(fetchItems, {
        maxAttempts: 3,
        retryDelayMs: 0,
        shouldRetry: () => true,
        beforeRetry: async () => { beforeRetryCount++ },
      })()

      expect(beforeRetryCount).toBe(2)
    })

    it('does not call beforeRetry when first attempt succeeds', async () => {
      let beforeRetryCalled = false
      const fetchItems = async () => ['ok']

      await retriable(fetchItems, {
        maxAttempts: 3,
        retryDelayMs: 0,
        shouldRetry: () => false,
        beforeRetry: async () => { beforeRetryCalled = true },
      })()

      expect(beforeRetryCalled).toBe(false)
    })
  })

  describe('retry delay', () => {
    beforeEach(() => { jest.useFakeTimers() })
    afterEach(() => { jest.useRealTimers() })

    it('waits retryDelayMs between attempts', async () => {
      let callCount = 0
      const fetchItems = async () => {
        callCount++
        return callCount >= 2 ? ['done'] : []
      }

      const promise = retriable(fetchItems, {
        maxAttempts: 3,
        retryDelayMs: 50,
        shouldRetry: (items) => items.length === 0,
      })()

      await jest.advanceTimersByTimeAsync(50)
      await promise

      expect(callCount).toBe(2)
      expect(jest.getTimerCount()).toBe(0)
    })
  })

  describe('single attempt (maxAttempts = 1)', () => {
    it('returns result without retry when shouldRetry is false', async () => {
      const result = await retriable(async () => 'ok', {
        maxAttempts: 1,
        retryDelayMs: 0,
        shouldRetry: () => false,
      })()

      expect(result).toBe('ok')
    })

    it('returns result without retry when shouldRetry is true', async () => {
      const result = await retriable(async () => 'only-attempt', {
        maxAttempts: 1,
        retryDelayMs: 0,
        shouldRetry: () => true,
      })()

      expect(result).toBe('only-attempt')
    })
  })

  describe('argument passing', () => {
    it('passes arguments through to the wrapped function', async () => {
      const concat = async (a: string, b: number) => `${a}-${b}`

      const result = await retriable(concat, {
        maxAttempts: 1,
        retryDelayMs: 0,
        shouldRetry: () => false,
      })('hello', 42)

      expect(result).toBe('hello-42')
    })
  })

  describe('retry without beforeRetry', () => {
    it('retries without calling beforeRetry when it is not provided', async () => {
      let callCount = 0
      const fetchItems = async () => {
        callCount++
        return callCount >= 2 ? ['done'] : []
      }

      const result = await retriable(fetchItems, {
        maxAttempts: 3,
        retryDelayMs: 0,
        shouldRetry: (items) => items.length === 0,
      })()

      expect(result).toEqual(['done'])
      expect(callCount).toBe(2)
    })
  })
})
