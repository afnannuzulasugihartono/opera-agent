# @last-edited: 2026-10-06 08:31 UTC+7.
# @title: build-store-package — writes the Chrome Web Store zip and its own manifest.
# @state: the package passes the store's rejection checks; the upload itself needs a Google account.
# @dependencies: none; the PNG encoder in draw-icon.py and the zipfile stdlib.

"""Build the Chrome Web Store package from the extension source.

The store rejects two fields the sideload build needs: `key`, because the store
assigns the extension id itself, and `update_url`, because the store owns updates
once an extension is listed. So this writes a separate manifest and a separate
zip rather than editing the one the sideload path depends on.

Run: py scripts/build-store-package.py
"""

import hashlib
import json
import os
import shutil
import sys
import tempfile
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(REPO, "extension")
OUT_ZIP = os.path.join(REPO, "store", "opera-agent-store.zip")
OUT_MANIFEST = os.path.join(REPO, "store", "store-manifest.json")

STORE_NAME = "Opera Agent"

# WHY 132 characters: that is the store's hard limit and it is counted on the
# rendered listing, so anything longer is silently truncated rather than refused.

STORE_DESC = (
    "Bawa asisten AI Anda mengemudikan browser: klik, ketik, isi formulir, "
    "baca halaman. Anda pilih modelnya."
)

def store_manifest():
    """The sideload manifest with the two store-rejected fields removed."""
    with open(os.path.join(EXT, "manifest.json"), encoding="utf-8") as handle:
        manifest = json.load(handle)

    # WHY a copy and not a mutation: the sideload installer writes a policy naming
    # the id derived from `key`, and the CRX served for updates is signed with it.
    # Removing either from the real manifest would break every install that already
    # works, and the store gives the extension a different id anyway.

    manifest.pop("key", None)
    manifest.pop("update_url", None)

    # The store listing is the one place a person reads this, so the description
    # here is the user-facing one rather than the internal one.

    manifest["name"] = STORE_NAME
    manifest["description"] = STORE_DESC

    # WHY the version is rewritten rather than the source one touched: the store
    # requires four dot-separated parts and the project carries three. The build
    # appends a zero so a release version still sorts and compares as expected.

    parts = manifest.get("version", "0.0.0").split(".")
    if len(parts) == 3:
        manifest["version"] = ".".join(parts + ["0"])

    manifest["icons"] = {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png",
    }
    return manifest

def write_manifest(manifest):
    os.makedirs(os.path.dirname(OUT_MANIFEST), exist_ok=True)
    with open(OUT_MANIFEST, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

def build_zip(manifest):
    os.makedirs(os.path.dirname(OUT_ZIP), exist_ok=True)

    # Staging in a temp directory is what lets manifest.json be written last with
    # the store's field set, without a second copy of every other file in the repo.

    stage = tempfile.mkdtemp(prefix="opera-store-")
    try:
        for name in os.listdir(EXT):
            source = os.path.join(EXT, name)
            if os.path.isdir(source) and name != "__pycache__":
                shutil.copytree(source, os.path.join(stage, name))
            elif os.path.isfile(source) and name != "manifest.json":
                shutil.copy2(source, os.path.join(stage, name))

        with open(os.path.join(stage, "manifest.json"), "w", encoding="utf-8", newline="\n") as handle:
            json.dump(manifest, handle, indent=2, ensure_ascii=False)
            handle.write("\n")

        # WHY the fixed timestamp: a zip entry carries the file's mtime, so two builds
        # of identical source produce different bytes and a different digest. The
        # digest is what gets recorded for the upload, so it has to mean something.

        stamp = (1980, 1, 1, 0, 0, 0)
        with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as archive:
            for root, dirs, files in os.walk(stage):
                dirs.sort()
                for name in sorted(files):
                    full = os.path.join(root, name)
                    info = zipfile.ZipInfo(
                        os.path.relpath(full, stage).replace(os.sep, "/"), stamp
                    )

                    # ZipInfo defaults to stored mode when written this way, so the
                    # compression has to be set explicitly or the package grows.

                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    with open(full, "rb") as handle:
                        archive.writestr(info, handle.read())
    finally:
        shutil.rmtree(stage, ignore_errors=True)

def verify(manifest):
    """Check the package against the store's rejection rules before it is uploaded."""
    with zipfile.ZipFile(OUT_ZIP) as archive:
        names = archive.namelist()
        inner = json.loads(archive.read("manifest.json"))

    problems = []
    if "key" in inner:
        problems.append("manifest carries a key; the store assigns the id itself")
    if "update_url" in inner:
        problems.append("manifest carries an update_url; the store owns updates")
    if inner.get("manifest_version") != 3:
        problems.append("only MV3 is accepted")
    if inner.get("version", "").count(".") != 3:
        problems.append("the store wants four dot-separated version parts")
    if not inner.get("description") or len(inner["description"]) > 132:
        problems.append("the store wants a description of at most 132 characters")
    for size in inner.get("icons", {}).values():
        if size not in names:
            problems.append(f"the manifest names an icon the package does not contain: {size}")

    return problems, inner, names

def main():
    manifest = store_manifest()
    write_manifest(manifest)
    build_zip(manifest)
    problems, inner, names = verify(manifest)

    with open(OUT_ZIP, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()

    print(f"package : {os.path.relpath(OUT_ZIP, REPO)}")
    print(f"files   : {len(names)}")
    print(f"bytes   : {os.path.getsize(OUT_ZIP)}")
    print(f"sha256  : {digest}")
    print(f"name    : {inner['name']}")
    print(f"desc    : {len(inner['description'])} chars")
    if problems:
        print()
        print("the store would reject this package:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("store-ready: no rejected field, MV3, version and icons check out")
    return 0

if __name__ == "__main__":
    sys.exit(main())