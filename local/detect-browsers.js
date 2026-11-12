// @last-edited: 2026-11-12 UTC+7.
// @title: detect-browsers - finds the browsers this machine can install into, by path probe, nothing else.
// @state: a pure function of a probe and the environment; no registry reads, no version detection, no writes.
// @dependencies: none.

// WHY A PATH PROBE AND NOT A REGISTRY READ.
// The registry tells you what is registered, not what is present. Chrome installed for one user is invisible to HKLM probing, and Brave registers itself under a vendor key no automation should trust.
// The file system does not lie about presence, and the probe injects for tests.

const roots = () => ({
  programFiles: process.env['ProgramFiles'] || 'C:\\Program Files',
  programFilesX86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  localAppData: process.env['LOCALAPPDATA'] || '',
});

const join = (root, tail) => (root ? `${root}\\${tail}` : '');

export function browserCandidates() {
  const { programFiles, programFilesX86, localAppData } = roots();
  return [
    { id: 'chrome', path: join(programFiles, 'Google\\Chrome\\Application\\chrome.exe') },
    { id: 'chrome', path: join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe') },
    { id: 'chrome', path: join(localAppData, 'Google\\Chrome\\Application\\chrome.exe') },
    { id: 'brave', path: join(programFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
    { id: 'brave', path: join(programFilesX86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
    { id: 'brave', path: join(localAppData, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
    { id: 'edge', path: join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe') },
    { id: 'edge', path: join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe') },
    { id: 'edge', path: join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe') },
  ].filter((entry) => entry.path);
}

export function probeBrowsers(existsAt) {
  const seen = new Set();
  return browserCandidates().filter((entry) => existsAt(entry.path)).filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}
