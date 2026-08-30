import JSZip from 'jszip';
import { webcontainer } from '~/lib/webcontainer';
import { WORK_DIR } from '~/utils/constants';

const EXCLUDED_DIRS = new Set(['node_modules', '.git']);
const EXCLUDED_PREFIXES = ['node_modules/', '.git/'];

function isExcluded(relativePath: string): boolean {
  if (!relativePath) return true;
  const top = relativePath.split('/')[0];
  if (EXCLUDED_DIRS.has(top)) return true;
  for (const prefix of EXCLUDED_PREFIXES) {
    if (relativePath === prefix.slice(0, -1) || relativePath.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Reads the entire WebContainer virtual filesystem via webcontainer.fs,
 * excluding node_modules and .git, and bundles it with JSZip client-side.
 * Matches ARCHITECTURE.md §5.5: "Download as ZIP: Export the entire in-memory
 * WebContainer project as a .zip archive for local development."
 */
export async function createProjectZip(): Promise<Blob> {
  const wc = await webcontainer;
  const zip = new JSZip();

  async function walk(absoluteDir: string, zipFolder: JSZip): Promise<void> {
    let entries: any[];
    try {
      entries = (await wc.fs.readdir(absoluteDir, { withFileTypes: true } as any)) as any[];
    } catch {
      return;
    }

    for (const entry of entries) {
      const name: string = entry.name;
      const absolutePath = `${absoluteDir}/${name}`.replace(/\/+/g, '/');
      // Compute relative path from WORK_DIR for zip structure
      let relativePath = absolutePath;
      if (absolutePath.startsWith(WORK_DIR)) {
        relativePath = absolutePath.slice(WORK_DIR.length).replace(/^\/+/, '');
      } else if (absolutePath.startsWith(wc.workdir)) {
        relativePath = absolutePath.slice(wc.workdir.length).replace(/^\/+/, '');
      } else {
        relativePath = absolutePath.replace(/^\/+/, '');
      }

      if (!relativePath || isExcluded(relativePath)) continue;

      const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : (entry as any).isDirectory ?? false;
      const isFile = typeof entry.isFile === 'function' ? entry.isFile() : (entry as any).isFile ?? !isDir;

      if (isDir) {
        const subFolder = zipFolder.folder(name);
        if (subFolder) await walk(absolutePath, subFolder);
      } else if (isFile) {
        try {
          // Read as binary to preserve all file types
          const data = await wc.fs.readFile(absolutePath);
          // data is Uint8Array when no encoding; JSZip accepts Uint8Array
          const content = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
          zipFolder.file(name, content);
        } catch (e) {
          // Skip unreadable files (e.g. large binary or permission)
          console.warn(`[zip-export] skip ${absolutePath}`, e);
        }
      }
    }
  }

  await walk(WORK_DIR, zip);

  // Generate with DEFLATE for reasonable size, matching typical browser download
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function downloadProjectZip(options?: { filename?: string }): Promise<string> {
  const zipBlob = await createProjectZip();
  // Use artifact title if available for filename
  let filename = options?.filename;
  if (!filename) {
    try {
      const { workbenchStore } = await import('~/lib/stores/workbench');
      const title = workbenchStore.firstArtifact?.title;
      const slug = title ? slugify(title) : '';
      filename = slug ? `${slug}.zip` : `project-${new Date().toISOString().slice(0, 10)}.zip`;
    } catch {
      filename = `project-${new Date().toISOString().slice(0, 10)}.zip`;
    }
  }
  triggerDownload(zipBlob, filename);
  return filename;
}
