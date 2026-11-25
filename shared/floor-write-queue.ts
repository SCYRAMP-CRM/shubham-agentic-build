// F-338: a floor's writes one after another. Each agent save is the floor's whole agent list, built from the floor the page holds, so two saves on the same floor must not be in the air together: the second would be built
// without the first's answer and would undo it. `queue(key, job)` runs `job` after every earlier job of that key has answered (whether it worked or not); different keys (floors) do not wait for each other.

export type WriteQueue = <T>(key: string, job: () => Promise<T>) => Promise<T>

export function createWriteQueue(): WriteQueue {
  const tails = new Map<string, Promise<void>>()
  return <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(job)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return run
  }
}
