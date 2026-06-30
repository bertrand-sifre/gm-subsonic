import type { ImportRecord, Library, LibraryStatus, UploadOutcome } from '@vdm/shared';

/** Réponse des routes qui importent (import manuel ou dépôt de fichiers). */
export type ImportResponse = { status: LibraryStatus; library: Library; lastImport: ImportRecord | null };

export async function fetchLibrary(): Promise<Library> {
  const res = await fetch('/api/library');
  if (!res.ok) throw new Error(`/api/library: HTTP ${res.status}`);
  return (await res.json()) as Library;
}

/** État de gestion de la bibliothèque (surveillance, import en cours, dernier import). */
export async function fetchLibraryStatus(): Promise<LibraryStatus> {
  const res = await fetch('/api/library/status');
  if (!res.ok) throw new Error(`/api/library/status: HTTP ${res.status}`);
  return (await res.json()) as LibraryStatus;
}

/** Déclenche un import + re-scan côté serveur ; renvoie l'état + la bibliothèque fraîche. */
export async function triggerImport(): Promise<ImportResponse> {
  const res = await fetch('/api/library/import', { method: 'POST' });
  if (!res.ok) throw new Error(`/api/library/import: HTTP ${res.status}`);
  return (await res.json()) as ImportResponse;
}

/** Dépose des fichiers (multipart) dans `library/` ; le serveur les importe puis renvoie l'état. */
export async function uploadFiles(files: File[]): Promise<ImportResponse & UploadOutcome> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const res = await fetch('/api/library/upload', { method: 'POST', body: form });
  if (!res.ok) {
    let msg = `/api/library/upload: HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* réponse non-JSON : on garde le message HTTP */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ImportResponse & UploadOutcome;
}

/** Active/désactive la surveillance du dossier `library/` (persistée côté serveur). */
export async function setWatch(enabled: boolean): Promise<LibraryStatus> {
  const res = await fetch('/api/library/watch', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`/api/library/watch: HTTP ${res.status}`);
  return ((await res.json()) as { status: LibraryStatus }).status;
}
