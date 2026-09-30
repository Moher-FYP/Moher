/**
 * Runs async tasks one at a time, in order. The relayer is a single account, so every
 * transaction it sends goes through one queue — that keeps nonces sequential and lets the mock
 * vault's book change in the same order the chain does.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Resolves once every task queued so far has finished. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}
