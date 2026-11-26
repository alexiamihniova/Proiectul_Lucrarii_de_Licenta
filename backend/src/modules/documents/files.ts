import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { DocumentFormat } from '../../core/domain.js';

/**
 * Uploaded files on disk (docs/design/documents.md, section 8).
 *
 * The path of a file is built ONLY from numbers and the format: `<root>/<user id>/<document
 * id>.<format>`. The name the student gave never reaches the file system, so no name can climb
 * out of the directory, hide a file or collide with another one. Files are never executed and
 * are not served statically; the only way out is `open`, after the owner has been checked.
 */

export interface FileStore {
  /** Writes the file; never overwrites an existing one. */
  write(userId: number, documentId: number, format: DocumentFormat, content: Buffer): Promise<void>;
  /** The whole file, for the analysis. `null` when it is not there. */
  read(userId: number, documentId: number, format: DocumentFormat): Promise<Buffer | null>;
  /** A stream over the file and its size, for the download. `null` when it is not there. */
  open(
    userId: number,
    documentId: number,
    format: DocumentFormat,
  ): Promise<{ stream: Readable; sizeBytes: number } | null>;
  /** Deletes the file. Resolves `true` when it was there; never throws for a missing file. */
  remove(userId: number, documentId: number, format: DocumentFormat): Promise<boolean>;
  /** Deletes the directory of a user with everything in it; succeeds when there is none. */
  removeUserDirectory(userId: number): Promise<void>;
  /** What is on disk, for the clean-up of orphans. */
  scan(): Promise<StoredUserDirectory[]>;
  /** Deletes a directory found by `scan`. */
  removeScannedDirectory(userId: number): Promise<void>;
  /** Deletes a file found by `scan`. */
  removeScannedFile(userId: number, fileName: string): Promise<void>;
}

export interface StoredFile {
  name: string;
  /** From the name, when it is `<id>.<format>`; otherwise `null` and the file is left alone. */
  documentId: number | null;
  modifiedAt: number;
}

export interface StoredUserDirectory {
  userId: number;
  files: StoredFile[];
}

const FILE_NAME = /^(\d+)\.(pdf|docx|txt)$/;
const DIRECTORY_NAME = /^[1-9]\d*$/;

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** A user id that may name a directory: a positive integer. Anything else is refused. */
function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new RangeError('invalid user id');
}

function assertDocumentId(documentId: number): void {
  if (!Number.isSafeInteger(documentId) || documentId <= 0) {
    throw new RangeError('invalid document id');
  }
}

export function createFileStore(uploadDirectory: string): FileStore {
  const root = resolve(uploadDirectory);
  const directoryOf = (userId: number) => {
    assertUserId(userId);
    return join(root, String(userId));
  };
  const pathOf = (userId: number, documentId: number, format: DocumentFormat) => {
    assertDocumentId(documentId);
    return join(directoryOf(userId), `${documentId}.${format}`);
  };

  return {
    async write(userId, documentId, format, content) {
      await mkdir(directoryOf(userId), { recursive: true, mode: 0o700 });
      await writeFile(pathOf(userId, documentId, format), content, { flag: 'wx', mode: 0o600 });
    },

    async read(userId, documentId, format) {
      try {
        return await readFile(pathOf(userId, documentId, format));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async open(userId, documentId, format) {
      const path = pathOf(userId, documentId, format);
      try {
        const { size } = await stat(path);
        return { stream: createReadStream(path), sizeBytes: size };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async remove(userId, documentId, format) {
      try {
        await unlink(pathOf(userId, documentId, format));
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },

    async removeUserDirectory(userId) {
      await rm(directoryOf(userId), { recursive: true, force: true });
    },

    async scan() {
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      const result: StoredUserDirectory[] = [];
      for (const entry of entries) {
        if (!DIRECTORY_NAME.test(entry)) continue; // not ours: leave it alone
        const userId = Number(entry);
        if (!Number.isSafeInteger(userId)) continue;
        const files: StoredFile[] = [];
        for (const name of await readdir(join(root, entry)).catch(() => [] as string[])) {
          const info = await stat(join(root, entry, name)).catch(() => null);
          if (!info?.isFile()) continue;
          const match = FILE_NAME.exec(name);
          files.push({
            name,
            documentId: match ? Number(match[1]) : null,
            modifiedAt: info.mtimeMs,
          });
        }
        result.push({ userId, files });
      }
      return result;
    },

    async removeScannedDirectory(userId) {
      await rm(directoryOf(userId), { recursive: true, force: true });
    },

    async removeScannedFile(userId, fileName) {
      if (!FILE_NAME.test(fileName)) throw new RangeError('not a stored file name');
      await unlink(join(directoryOf(userId), fileName)).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    },
  };
}
