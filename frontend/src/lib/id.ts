/** Short, sortable, collision-safe enough ids that read fine in a URL. */
export function newId(prefix = ''): string {
  const rnd = crypto.getRandomValues(new Uint8Array(9))
  const body = Array.from(rnd, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
  return prefix ? `${prefix}_${body}` : body
}

export const nowIso = () => new Date().toISOString()
