import type { Library } from '@vdm/shared';

export async function fetchLibrary(): Promise<Library> {
  const res = await fetch('/api/library');
  if (!res.ok) throw new Error(`/api/library: HTTP ${res.status}`);
  return (await res.json()) as Library;
}
