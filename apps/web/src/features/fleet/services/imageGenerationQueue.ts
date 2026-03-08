let generationInProgress = false;
const pendingQueue: Array<() => Promise<void> | void> = [];

function runNextImageGeneration() {
  const next = pendingQueue.shift();
  if (!next) {
    generationInProgress = false;
    return;
  }

  generationInProgress = true;
  void Promise.resolve()
    .then(next)
    .catch((error) => {
      console.error("[Images] Queued image generation failed:", error);
    })
    .finally(() => {
      runNextImageGeneration();
    });
}

export function enqueueImageGeneration(fn: () => Promise<void> | void) {
  pendingQueue.push(fn);
  if (!generationInProgress) {
    runNextImageGeneration();
  }
}

/** @deprecated Queue completion is now managed internally. */
export function dequeueImageGeneration() {
  // Intentionally retained as a no-op for compatibility with older callers.
}
