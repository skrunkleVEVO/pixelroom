// Getting files off the device: the share sheet (which is how photos reach the
// iPhone Photos app or straight into Instagram/TikTok) or a plain download.

export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files });
  } catch {
    return false;
  }
}

/** Resolves to false if the person closed the share sheet. Must run inside a tap. */
export async function shareFiles(files: File[]): Promise<boolean> {
  try {
    await navigator.share({ files });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches;
}

export function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
