// Android lets an installed web app appear in the system share menu. The service
// worker receives the shared photos, parks them in a cache and opens the app with
// ?shared; this picks them up once.

export const SHARE_CACHE = 'pixelroom-shared';

export async function takeSharedFiles(): Promise<File[]> {
  const url = new URL(location.href);
  if (!url.searchParams.has('shared') || !('caches' in window)) return [];
  history.replaceState(null, '', url.pathname);
  try {
    const cache = await caches.open(SHARE_CACHE);
    const keys = await cache.keys();
    const files: File[] = [];
    for (const key of keys) {
      const res = await cache.match(key);
      if (res) {
        const blob = await res.blob();
        const name = decodeURIComponent(res.headers.get('x-filename') ?? 'shared-photo');
        files.push(new File([blob], name, { type: blob.type }));
      }
      await cache.delete(key);
    }
    return files;
  } catch {
    return [];
  }
}
