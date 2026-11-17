/** Saves in-memory content as a file through a temporary object URL. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function downloadJson(filename: string, json: string): void {
  downloadBlob(filename, new Blob([json], { type: 'application/json' }))
}

/** Reads a user-chosen file as text, refusing anything larger than `maxBytes`. */
export async function readTextFile(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error('Ukuran file terlalu besar.')
  }
  return file.text()
}
