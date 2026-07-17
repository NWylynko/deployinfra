/**
 * Run an async function over items with a fixed concurrency limit.
 * Useful for parallel file uploads without saturating the network.
 */
export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        await fn(items[idx]!, idx)
      }
    }),
  )
}
