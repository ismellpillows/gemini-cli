/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnAsync } from '@google/gemini-cli-core';

/**
 * Checks if the system clipboard contains an image (macOS only for now)
 * @returns true if clipboard contains an image
 */
export async function clipboardHasImage(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    // Use osascript to check clipboard type
    const { stdout } = await spawnAsync('osascript', ['-e', 'clipboard info']);
    const imageRegex =
      /«class PNGf»|TIFF picture|JPEG picture|GIF picture|«class JPEG»|«class TIFF»/;
    return imageRegex.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Saves the image from clipboard to a temporary file (macOS only for now)
 * @param targetDir The target directory to create temp files within
 * @returns The path to the saved image file, or null if no image or error
 */
export async function saveClipboardImage(
  targetDir?: string,
): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // Create a temporary directory for clipboard images within the target directory
    // This avoids security restrictions on paths outside the target directory
    const baseDir = targetDir || process.cwd();
    const tempDir = path.join(baseDir, '.gemini-clipboard');
    await fs.mkdir(tempDir, { recursive: true });

    // Generate a unique filename with timestamp
    const timestamp = new Date().getTime();

    // Try different image formats in order of preference
    const formats = [
      { class: 'PNGf', extension: 'png' },
      { class: 'JPEG', extension: 'jpg' },
      { class: 'TIFF', extension: 'tiff' },
      { class: 'GIFf', extension: 'gif' },
    ];

    for (const format of formats) {
      const tempFilePath = path.join(
        tempDir,
        `clipboard-${timestamp}.${format.extension}`,
      );

      // Try to save clipboard as this format
      const script = `
        try
          set imageData to the clipboard as «class ${format.class}»
          set fileRef to open for access POSIX file "${tempFilePath}" with write permission
          write imageData to fileRef
          close access fileRef
          return "success"
        on error errMsg
          try
            close access POSIX file "${tempFilePath}"
          end try
          return "error"
        end try
      `;

      const { stdout } = await spawnAsync('osascript', ['-e', script]);

      if (stdout.trim() === 'success') {
        // Verify the file was created and has content
        try {
          const stats = await fs.stat(tempFilePath);
          if (stats.size > 0) {
            return tempFilePath;
          }
        } catch {
          // File doesn't exist, continue to next format
        }
      }

      // Clean up failed attempt
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }

    // No format worked
    return null;
  } catch (error) {
    console.error('Error saving clipboard image:', error);
    return null;
  }
}

/**
 * Cleans up old temporary clipboard image files
 * Removes files older than 1 hour
 * @param targetDir The target directory where temp files are stored
 */
export async function cleanupOldClipboardImages(
  targetDir?: string,
): Promise<void> {
  try {
    const baseDir = targetDir || process.cwd();
    const tempDir = path.join(baseDir, '.gemini-clipboard');
    const files = await fs.readdir(tempDir);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const file of files) {
      if (
        file.startsWith('clipboard-') &&
        (file.endsWith('.png') ||
          file.endsWith('.jpg') ||
          file.endsWith('.tiff') ||
          file.endsWith('.gif'))
      ) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs < oneHourAgo) {
          await fs.unlink(filePath);
        }
      }
    }
  } catch {
  }
}

/**
 * Writes text to the clipboard.
 * - If running inside a terminal that supports OSC 52 (e.g. VS Code Integrated Terminal),
 *   this copies to the **client** clipboard (works over SSH/Remote).
 * - Otherwise falls back to platform clipboard tools on the **host** (server) side.
 *
 * Throws if all strategies fail.
 */
export async function writeTextToClipboard(text: string): Promise<void> {
  // 1) Prefer OSC 52 so copies go to the local client clipboard in remote sessions.
  if (await tryWriteClipboardOSC52(text)) return;

  // 2) Fallback to server-side OS clipboard tools.
  if (await tryWriteClipboardOS(text)) return;

  throw new Error(
    'Failed to write to clipboard (OSC 52 unsupported/blocked and no OS clipboard tool found).'
  );
}

/** Try copying via OSC 52 so the terminal client (e.g. VS Code) receives it. */
async function tryWriteClipboardOSC52(text: string): Promise<boolean> {
  try {
    // Some terminals reject very large payloads; keep it reasonable.
    const base64 = Buffer.from(text, 'utf8').toString('base64');
    const MAX_BASE64 = 100_000; // ~100 KB; tweak if you need larger copies
    if (base64.length > MAX_BASE64) return false;

    const osc52 = `\u001B]52;c;${base64}\u0007`; // ESC ] 52 ; c ; <b64> BEL

    // Prefer stdout if we have a TTY; otherwise try writing to /dev/tty (POSIX).
    if (process.stdout.isTTY) {
      process.stdout.write(osc52);
      return true;
    }

    if (process.platform !== 'win32') {
      try {
        const fh = await fs.open('/dev/tty', 'a');
        try {
          await fh.write(osc52);
          return true;
        } finally {
          await fh.close();
        }
      } catch {
        // no /dev/tty or not permitted — fall through
      }
    }
  } catch {
    // ignore and fall back
  }
  return false;
}

/** Fallback to host OS clipboard tools (this affects the *server* clipboard). */
async function tryWriteClipboardOS(text: string): Promise<boolean> {
  // Use a temp file + shell redirection to avoid quoting/encoding pitfalls
  const baseDir = process.cwd();
  const tempDir = path.join(baseDir, '.gemini-clipboard');
  const tmpPath = path.join(tempDir, `text-${Date.now()}.txt`);

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(tmpPath, text, 'utf8');

    if (process.platform === 'darwin') {
      // macOS: pbcopy
      await spawnAsync('bash', ['-lc', `pbcopy < "${tmpPath}"`]);
      return true;
    }

    if (process.platform === 'win32') {
      // Windows: PowerShell Set-Clipboard with UTF-8, using literal path to handle specials
      const ps = [
        '-NoProfile',
        '-Command',
        `Get-Content -Raw -LiteralPath '${tmpPath.replace(/'/g, "''")}' | Set-Clipboard`,
      ];
      await spawnAsync('powershell.exe', ps);
      return true;
    }

    // Linux/Unix: try wl-copy first, then xclip
    try {
      await spawnAsync('bash', ['-lc', `command -v wl-copy >/dev/null 2>&1 && wl-copy < "${tmpPath}"`]);
      return true;
    } catch {
      // ignore and try xclip
    }
    await spawnAsync('bash', [
      '-lc',
      `command -v xclip >/dev/null 2>&1 && xclip -selection clipboard < "${tmpPath}"`,
    ]);
    return true;
  } catch {
    return false;
  } finally {
    // Best-effort cleanup
    try {
      await fs.unlink(tmpPath);
    } catch {}
  }
}
