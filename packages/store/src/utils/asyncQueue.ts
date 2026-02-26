let sharedQueue: Promise<void> = Promise.resolve();

export async function enqueueSerialUpdate(update: () => Promise<void>): Promise<void> {
  const run = sharedQueue.then(update, update);
  sharedQueue = run.catch(() => undefined);
  return run;
}
