/**
 * Lightweight async mutex with try-lock semantics.
 *
 * Unlike a traditional mutex that queues waiters, `tryLock()` returns `false`
 * immediately when already held — callers skip rather than queue.  This is the
 * correct primitive for tick processing where a missed lock simply means "the
 * next tick will retry."
 *
 * The previous approach used bare `let isProcessing = false` booleans which
 * are NOT safe across `await` points: two async functions can both read the
 * flag as `false` before either sets it to `true`.
 *
 * This class solves the problem by making `tryLock()` synchronous and
 * non-reentrant — the flag is set atomically within a single microtask.
 */
export class AsyncMutex {
  private _locked = false;

  /** `true` when the mutex is currently held. */
  get isLocked(): boolean {
    return this._locked;
  }

  /**
   * Attempt to acquire the lock.
   * @returns `true` if the lock was acquired, `false` if already held.
   */
  tryLock(): boolean {
    if (this._locked) return false;
    this._locked = true;
    return true;
  }

  /** Release the lock.  Safe to call even if not currently held. */
  unlock(): void {
    this._locked = false;
  }

  /** Force-reset the lock (e.g. for test teardown). */
  reset(): void {
    this._locked = false;
  }
}
