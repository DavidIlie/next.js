/**
 * An AsyncIterable<boolean> that records, over time, whether a prerender has
 * accessed runtime data (see
 * `PrerenderStoreModernServer['runtimeDataAccessedIterable']`).
 * It's embedded in the RSC payload (`InitialRSCPayload['u']`) so Flight
 * serializes each change at the position in the stream where it happened.
 * That makes the value rewindable: a truncated (shell) decode of the page
 * data reads the flag's value as of the shell stage, which is how the
 * per-segment prefetch responses derive a shell-accurate
 * `needsRuntimeRequest` (see collect-segment-data). Follows the same pattern
 * as `StaleTimeIterable`.
 *
 * The flag is monotonic — it only ever flips from false to true — so the
 * iterable yields an initial `false` and at most one `true`.
 */
export class RuntimeDataAccessedIterable {
  private _resolve: ((result: IteratorResult<boolean>) => void) | null = null
  private _done = false
  private _buffer: boolean[] = [false]
  private _currentValue = false

  update(value: boolean): void {
    if (this._done || value === this._currentValue) return
    this._currentValue = value
    if (this._resolve) {
      this._resolve({ value, done: false })
      this._resolve = null
    } else {
      this._buffer.push(value)
    }
  }

  close(): void {
    if (this._done) return
    this._done = true
    if (this._resolve) {
      this._resolve({ value: undefined, done: true })
      this._resolve = null
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<boolean> {
    return {
      next: () => {
        if (this._buffer.length > 0) {
          return createSyncFulfilledResult({
            value: this._buffer.shift()!,
            done: false,
          })
        }
        if (this._done) {
          return createSyncFulfilledResult({ value: undefined, done: true })
        }
        return new Promise<IteratorResult<boolean>>((resolve) => {
          this._resolve = resolve
        })
      },
    }
  }
}

/**
 * A thenable that invokes its callback synchronously, mirroring how Flight's
 * own decoded chunks behave for already-fulfilled values. When Flight
 * serializes an async iterable whose iterator results resolve synchronously,
 * it emits each value row in the same synchronous pass as the reference to
 * the iterable itself — which is what keeps an already-known value's row
 * inside the shell byte prefix of a segment prefetch response. A native
 * resolved promise would defer the row to a microtask, allowing it to slip
 * into a later flush, past the shell byte boundary. (Consumers that `await`
 * instead of calling `then` directly still work: promise assimilation treats
 * this as an ordinary thenable.)
 */
function createSyncFulfilledResult(
  result: IteratorResult<boolean>
): Promise<IteratorResult<boolean>> {
  return {
    status: 'fulfilled',
    value: result,
    then(
      onFulfilled: (value: IteratorResult<boolean>) => unknown,
      _onRejected?: (reason: unknown) => unknown
    ) {
      onFulfilled(result)
    },
  } as unknown as Promise<IteratorResult<boolean>>
}
