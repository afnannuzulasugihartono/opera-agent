// @last-edited: 2026-10-21 UTC+7.
// @title: primitives-file — the verbs that move a file: upload, drop, and download.
// @state: the file chooser, the dropped file, and the download that proves itself on disk.
// @dependencies: node:buffer, ./page-expressions.js.

// WHY THIS FILE EXISTS

// A file is the one thing a browser drive produces that somebody else will open, so the rules around it are stricter than the rules around a click.
// A file that is still being written is not a file.
// A file that landed under the portal's own name is not the name the bookkeeper needs.
// A file that nobody can point at on disk is not proof.

// These four verbs share that weight and nothing else: they speak to the file system, to the file chooser and to the download folder, and they share no state with the page verbs except the driver itself.
// Keeping them here means the page verbs stay about the page, and a reader who wants to know what happens to a file finds it in one place.

// WHY THE VERBS TAKE THE DRIVER AS AN ARGUMENT.
// A file verb needs the rest of the driver - to resolve a row, to click a handle, to read the page - and the page verbs need the file verbs' expressions.
// Passing the driver in keeps one object per driver and no import cycle, and the names inside stay exactly the names they had.

import { Buffer } from 'node:buffer';

import {
  DROP_FRONT_SETTLE_MS,
  DROP_PHASE_GAP_MS,
  DROP_PHASES,
  DROP_SETTLE_MS,
  UPLOAD_FIND_ATTEMPTS,
  UPLOAD_FIND_GAP_MS,
  UPLOAD_INPUT_EXPRESSION,
  dragMimeType
} from './page-expressions.js';

export interface FilePrimitivesOptions {
  cdp: { send(method: string, params?: Record<string, unknown>): Promise<import('./cdp.js').CdpResult> };
  sleep: (ms: number) => Promise<unknown>;
  fs?: typeof import('node:fs');
  os?: typeof import('node:os');
  path?: typeof import('node:path');
  readState: () => Promise<{ url?: unknown; [key: string]: unknown }>;
  bridge?: boolean;
}

// The three node modules are always injected by the assembly point (tests inject doubles); this guard refuses a call without them.

export function filePrimitives(primitives: import('./types.js').JsonRecord, { cdp, sleep, fs, os, path, readState, bridge = false }: FilePrimitivesOptions) {
  if (!fs || !os || !path) throw new Error('filePrimitives needs fs, os and path');

  // WHY THE FILE IS PREPARED IN ONE PLACE.
  // Upload and drop take the same two inputs - a base64 payload or a path - and must answer the same three questions: where the bytes are, how many there are, and how to remove the temporary copy.
  // Two copies of that answer drift the moment one gains a guard the other lacks, so it lives here.

  const materialize = ({ data, filePath, filename, verb, prefix }: { data?: unknown; filePath?: unknown; filename: string; verb: string; prefix: string }) => {
    const hasData = data !== null && data !== undefined;
    const hasPath = filePath !== null && filePath !== undefined;
    if (hasData === hasPath) throw new Error(`${verb} needs exactly one of data or path.`);
    if (hasPath) {
      if (!fs.existsSync(String(filePath))) throw new Error(`${verb}: no such file ${JSON.stringify(String(filePath))}`);
      return { target: String(filePath), bytes: fs.statSync(String(filePath)).size, cleanup: null as null | (() => void) };
    }
    const decoded = Buffer.from(String(data), 'base64');
    if (decoded.length === 0) throw new Error(`${verb}: data carries no bytes.`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const target = path.join(dir, path.basename(filename));
    fs.writeFileSync(target, decoded);
    return {
      target,
      bytes: decoded.length,
      cleanup: () => {
        try {
          fs.unlinkSync(target);
        } catch {}
        try {
          fs.rmdirSync(dir);
        } catch {}
      }
    };
  };

  return {
    async upload({ filename, data = null, path: filePath = null }: { filename?: unknown; data?: unknown; path?: unknown } = {}) {
      if (!filename || typeof filename !== 'string') throw new Error('upload needs a filename.');
      const { target, bytes, cleanup } = materialize({
        data, filePath, filename, verb: 'upload', prefix: 'opera-upload-'
      });

      // WHY THE FINDER ASKS CDP BEFORE ASKING THE PAGE, AND SWEEPS THE FRAMES.
      // A page script can only walk shadow roots it is allowed to see, and Google Docs keeps its image input in a closed one inside its picker frame: the script reported no input while the input was demonstrably there.
      // `DOM.querySelectorAll` with `pierce` answers for a whole document, closed roots included, and returns only the matches — the entire pierced tree fetched at once timed out live on a heavy page.
      // `pierce` does not cross into a child frame, though, so each frame is asked for its owner, its owner's content document, and then the same pierced query.
      // The page script stays as the last road: it is the only one that can follow a frame the browser will not describe.

      const FILE_INPUT_SELECTOR = 'input[type=file]';

      const piercedInputIn = async (nodeId: unknown): Promise<number | null> => {
        const found = await cdp.send('DOM.querySelectorAll', { nodeId, selector: FILE_INPUT_SELECTOR, pierce: true });
        const hit = (found as { nodeIds?: unknown[] } | undefined)?.nodeIds?.[0];
        if (hit === undefined) return null;
        const described = await cdp.send('DOM.describeNode', { nodeId: hit });
        return (described as { node?: { backendNodeId?: number } } | undefined)?.node?.backendNodeId ?? null;
      };
      const findInputNode = async () => {
        const document_ = await cdp.send('DOM.getDocument', { depth: 0, pierce: true });
        const rootNodeId = (document_ as { root?: { nodeId?: unknown } } | undefined)?.root?.nodeId;
        return rootNodeId ? piercedInputIn(rootNodeId) : null;
      };
      const findInputInFrames = async () => {
        const tree = await cdp.send('Page.getFrameTree');
        const frames: string[] = [];
        interface FrameNode { frame?: { id?: unknown }; childFrames?: FrameNode[] }
        // The nested record arrives as the page's frame tree; the walker only needs frame ids and childFrames.
        const collect = (node: FrameNode | undefined) => {
          if (node?.frame?.id) frames.push(String(node.frame.id));
          for (const child of node?.childFrames ?? []) collect(child);
        };
        collect((tree as { frameTree?: FrameNode } | undefined)?.frameTree);
        for (const frameId of frames) {
          const owner = await cdp.send('DOM.getFrameOwner', { frameId }).catch(() => null);
          const backendNodeId = (owner as { backendNodeId?: unknown } | undefined)?.backendNodeId;
          if (backendNodeId === undefined) continue;
          const described = await cdp.send('DOM.describeNode', { backendNodeId }).catch(() => null);
          const documentNodeId = (described as { node?: { contentDocument?: { nodeId?: unknown } } } | undefined)?.node?.contentDocument?.nodeId ?? null;
          if (!documentNodeId) continue;
          const hit = await piercedInputIn(documentNodeId).catch(() => null);
          if (hit) return hit;
        }
        return null;
      };
      const findInputScript = async () => {
        const found = await cdp.send('Runtime.evaluate', {
          expression: UPLOAD_INPUT_EXPRESSION,
          returnByValue: false,
          objectGroup: 'opera-upload'
        });
        return (found as { result?: { objectId?: string } } | undefined)?.result?.objectId ?? null;
      };
      try {
        let node: number | null = null;
        let objectId: string | null = null;
        for (let attempt = 0; attempt < UPLOAD_FIND_ATTEMPTS && !node && !objectId; attempt++) {
          node = await findInputNode().catch(() => null);
          if (!node) node = await findInputInFrames().catch(() => null);
          if (!node) objectId = await findInputScript().catch(() => null);
          if (!node && !objectId && attempt + 1 < UPLOAD_FIND_ATTEMPTS) await sleep(UPLOAD_FIND_GAP_MS);
        }
        if (node) {
          await cdp.send('DOM.setFileInputFiles', { files: [target], backendNodeId: node });
          return { inputFound: true, filename, bytes };
        }
        if (!objectId) return { inputFound: false, filename };
        await cdp.send('DOM.setFileInputFiles', { files: [target], objectId });
        return { inputFound: true, filename, bytes };
      } finally {
        if (cleanup) cleanup();
        await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'opera-upload' }).catch(() => null);
      }
    },

    async dropFile({ x, y, filename, data = null, path: filePath = null }: { x?: unknown; y?: unknown; filename?: unknown; data?: unknown; path?: unknown } = {}) {
      if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
        throw new Error('drop_file needs x and y in the viewport.');
      }
      if (!filename || typeof filename !== 'string') throw new Error('drop_file needs a filename.');
      const { target, bytes, cleanup } = materialize({
        data, filePath, filename, verb: 'drop_file', prefix: 'opera-drop-'
      });
      const mimeType = dragMimeType(filename);
      const payload = {
        items: [{ mimeType, title: filename, data: '' }],
        files: [target],
        dragOperationsMask: 1
      };

      // WHY DRAGS ARE INTERCEPTED FIRST AND RELEASED ON EVERY WAY OUT.
      // Chrome only accepts a dispatched drag while interception is on, and a page left in that state stops believing real ones — the pointer would do nothing on this tab until it was released, which is worse than the problem being solved.
      // So the release is in the finally, where a failure still reaches.
      try {
        await cdp.send('Page.bringToFront');
        await sleep(DROP_FRONT_SETTLE_MS);
        await cdp.send('Input.setInterceptDrags', { enabled: true });
        for (const phase of DROP_PHASES) {
          await cdp.send('Input.dispatchDragEvent', { type: phase, x: Number(x), y: Number(y), data: payload });
          await sleep(DROP_PHASE_GAP_MS);
        }
        await sleep(DROP_SETTLE_MS);
        return { dropped: true, filename, bytes, x: Number(x), y: Number(y), mimeType };
      } finally {
        await cdp.send('Input.setInterceptDrags', { enabled: false }).catch(() => null);
        if (cleanup) cleanup();
      }
    },

    async interceptFileChooser(enabled: unknown) {
      await cdp.send('Page.setInterceptFileChooserDialog', { enabled: enabled === true });
      return { intercepting: enabled === true };
    },

    // WHY THE FILE ON DISK IS THE PROOF, NOT THE PROTOCOL EVENT.
    // The bridge road forwards commands and not events, so a listener here would fire on a debugging port and stay silent on the signed-in profile - the one road that matters.
    // The directory is therefore read until a new file stops growing, which is true on every road and survives a browser that lies about finishing.

    // WHY THE DOWNLOAD BEHAVIOR IS ARMED BEFORE THE CLICK AND RESET AFTER IT.
    // A click that starts a download has already chosen where the file goes; arming afterwards would only redirect the next one.
    // The reset is best effort, and it matters: the behavior is browser-wide, so leaving it armed would silently swallow every later download the person makes into this folder.

    // WHY A PARTIAL FILE IS NOT A RESULT.
    // Chrome writes `name.pdf.crdownload` while it works and renames on completion, so a directory scan that accepted either would report a truncated statement as delivered - the exact failure the proof layer exists to prevent.

    // WHY THE NEW NAME IS A NAME AND NOT A PATH.
    // A caller that can name the folder already has dir; letting saveAs carry a path would be a second, quieter way to write outside it, and a file name with a slash in it fails at the operating system with a message that says nothing about the rule that was broken.

    // WHY THE FILE IS RENAMED ONLY AFTER IT STOPS GROWING.
    // Renaming a download mid-write would leave Chrome writing to a path that no longer exists, so the new name is given at the only moment the file is whole.
    // The old file goes first because Windows refuses a rename onto an existing file, and pulling the same client-month twice is the normal case - a re-download is a deliberate replace.
    async download({
      handle = null, role = null, name = null, x = null, y = null,
      dir = null, saveAs = null, timeoutMs = 30000, settleMs = 250, intervalMs = 100
    }: {
      handle?: unknown; role?: unknown; name?: unknown; x?: unknown; y?: unknown; dir?: unknown; saveAs?: unknown; timeoutMs?: unknown; settleMs?: number; intervalMs?: number;
    } = {}) {
      const hasPoint = Number.isFinite(x) && Number.isFinite(y);
      const hasRow = role !== null && role !== undefined;
      const ways = [handle !== null && handle !== undefined, hasRow, hasPoint].filter(Boolean).length;
      if (ways !== 1) throw new Error('download needs exactly one of: a handle, a role and name, or an x and a y.');
      if (hasRow && (name === null || name === undefined || String(name) === '')) {
        throw new Error('download with a role also needs a name, because the role alone does not say which row.');
      }
      const renameTo = saveAs === null || saveAs === undefined ? null : String(saveAs);
      if (renameTo !== null && (renameTo === '' || path.basename(renameTo) !== renameTo || renameTo === '.' || renameTo === '..')) {
        throw new Error(`download saveAs must be a file name, not a path: "${renameTo}". The folder is dir.`);
      }
      const target = dir ? path.resolve(String(dir)) : path.join(os.homedir(), 'Downloads', 'opera-agent');
      fs.mkdirSync(target, { recursive: true });

      // WHY THE EXTENSION ROAD WATCHES THE FOLDERS CHROME MAY USE.
      // chrome.debugger refuses browser-level commands, so a drive over the extension cannot arm a download folder: "Browser.setDownloadBehavior" is not found on a page target and "Page.setDownloadBehavior" is refused as browser-level.
      // The file lands where Chrome puts it, and the driver moves it to the folder the caller named - or says it did not land.
      // OneDrive can move the Downloads known folder and Chrome honours that move, so the watch covers the home folder and the redirected one next to it; a miss names both so a reader can see the whole list that was checked.

      const bridged = bridge === true;
      const folderCandidates = bridged
        ? [path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'OneDrive', 'Downloads')]
        : [target];

      // WHY THE CANDIDATES ARE DEDUPED BY REAL PATH.
      // A moved Downloads folder and the one it points at can both answer to the same directory, and reading one download twice is exactly the ambiguity the refuse rule exists to catch.
      // The real path is asked only when the drive can ask it; a file system without it keeps the literal name.

      const seen = new Set<string>();
      const watched: string[] = [];
      for (const dir of folderCandidates) {
        let key = dir;
        try {
          key = typeof fs.realpathSync === 'function' ? fs.realpathSync(dir) : dir;
        } catch {
          key = dir;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        watched.push(dir);
      }
      const watchedLabel = watched.join(' or ');
      const listDir = (dir: string): string[] => {
        try {
          return fs.readdirSync(dir);
        } catch {
          return [];
        }
      };

      // WHY THE BEFORE-SET HOLDS WHOLE PATHS.
      // Two watched folders can hold the same file name, so a name is not an identity: keeping paths means a download that lands beside a same-named file in the other folder is still new.

      const before = new Set(watched.flatMap((dir) => listDir(dir).map((file) => path.join(dir, file))));

      let armedVia = 'browser';
      if (bridged) {
        armedVia = 'browser-folder';
      } else {
        try {
          await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: target });
        } catch (browserError: unknown) {
          try {
            await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: target });
            armedVia = 'page';
          } catch (pageError: unknown) {
            throw new Error(`download could not arm a folder: Browser said "${String((browserError as Error)?.message ?? browserError)}", Page said "${String((pageError as Error)?.message ?? pageError)}"`);
          }
        }
      }

      const started = Date.now();
      const pageBefore = await readState().catch(() => ({ url: '' }));
      try {
        let clicked: unknown;
        if (handle !== null && handle !== undefined) {
          clicked = await primitives.clickHandle(handle);
        } else if (hasRow) {
          const row = await primitives.resolveRow({ role, name });
          clicked = row.handle ? await primitives.clickHandle(row.handle) : await primitives.clickAt(row.x, row.y);
        } else {
          clicked = await primitives.clickAt(Number(x), Number(y));
        }

        const limit = Math.max(500, Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 30000);
        const deadline = started + limit;
        let growing = null;
        let stableAt = 0;
        const handOver = (newest: string, full: string, size: number) => {
          let file = newest;
          let where = full;
          if (bridged) {
            file = renameTo ?? newest;
            where = path.join(target, file);
            fs.rmSync(where, { force: true });
            try {
              fs.renameSync(full, where);
            } catch {
              try {
                fs.copyFileSync(full, where);
                fs.unlinkSync(full);
              } catch (copyError: unknown) {
                throw new Error(`the browser put the file at ${full}, and it could not be moved to ${where}: ${String((copyError as Error)?.message ?? copyError)}`);
              }
            }
          } else if (renameTo !== null && renameTo !== newest) {
            file = renameTo;
            where = path.join(target, renameTo);
            fs.rmSync(where, { force: true });
            try {
              fs.renameSync(full, where);
            } catch (error: unknown) {
              throw new Error(`the file landed as ${newest} but could not be renamed to ${renameTo}: ${String((error as Error)?.message ?? error)}. It is still at ${full}`);
            }
          }
          return {
            downloaded: true,
            file,
            path: where,
            bytes: size,
            dir: target,
            ms: Date.now() - started,
            armedVia,
            clicked,
            ...(file === newest ? {} : { landedAs: newest }),
            ...(bridged ? { landedAt: full } : {})
          };
        };
        for (;;) {
          const fresh = watched.flatMap((dir) => listDir(dir)
            .filter((file) => !before.has(path.join(dir, file)) && !file.endsWith('.crdownload') && !file.endsWith('.tmp'))
            .map((file) => ({ file, full: path.join(dir, file), dir })));

          // WHY MORE THAN ONE FINISHED CANDIDATE IS A REFUSAL.
          // The watched folders hold every download the person makes, so a second file appearing mid-click is somebody else's download and the newest of an ambiguous pair is a coin toss.
          // The answer names both with the folder each came from and moves neither, because a bookkeeper handed the wrong statement is worse than a driver that says it cannot tell.

          if (fresh.length > 1) {
            return {
              downloaded: false,
              why: `two files appeared in ${watchedLabel} during the click: ${fresh.map((entry) => `${entry.file} in ${entry.dir}`).join('; ')}. Download again while nothing else is downloading.`,
              candidates: fresh.map((entry) => entry.full),
              dir: target,
              watched: watchedLabel,
              ms: Date.now() - started,
              armedVia,
              clicked
            };
          }
          if (fresh.length) {
            // fresh.length was just checked, so the first entry exists.
            const firstFresh = fresh[0];
            if (firstFresh === undefined) continue;
            const { file, full } = firstFresh;
            const size = fs.statSync(full).size;
            if (size > 0) {
              if (!growing || growing.size !== size || growing.file !== file) {
                growing = { file, size };
                stableAt = Date.now();
              } else if (Date.now() - stableAt >= settleMs) {
                return handOver(file, full, size);
              }
            }
          }

          if (Date.now() >= deadline) {
            const partial = watched.map((dir) => listDir(dir).find((file) => file.endsWith('.crdownload'))).find(Boolean);
            const after = await readState().catch(() => ({ url: pageBefore.url }));
            const navigated = after.url && after.url !== pageBefore.url;
            const why = partial
              ? `a download started but ${partial} was still being written after ${limit} ms; call again with a longer timeoutMs`
              : navigated
                ? `the click navigated to ${after.url} instead of downloading; that page may render the file, so capture_page() it or use the page's own download control`
                : `no file appeared in ${watchedLabel} within ${limit} ms; the clicked control may open a viewer or a menu, or Chrome may be showing a save dialog - dialog_state() says which`;
            return {
              downloaded: false,
              why,
              dir: target,
              watched: watchedLabel,
              ms: Date.now() - started,
              armedVia,
              partial: partial ?? null,
              clicked
            };
          }
          await sleep(intervalMs);
        }
      } finally {
        if (!bridged) {
          await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => null);
          await cdp.send('Page.setDownloadBehavior', { behavior: 'default' }).catch(() => null);
        }
      }
    },
  };
}
