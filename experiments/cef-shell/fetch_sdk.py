"""Fetch the code-review-pinned CEF SDK on an ephemeral build agent only."""
import hashlib
import http.client
import json
import pathlib
import re
import shutil
import sys
import tarfile
import time
import urllib.parse
import urllib.request

DIST = "https://cef-builds.spotifycdn.com/"
VERSION = "156.0.14+g4fa4ab5+chromium-156.0.8078.48"
SHA256 = {
    "linux64": "4191ac920a91a052eba04afb6ed830d47aed46a3e246c434a2f062c23588dc8a",
    "windows64": "99f8a6dffd47417e0caee7845a98c549b41f1d4246cd715dec843ca4b699ee57",
}


def main():
    platform, target = sys.argv[1:]
    if platform not in ("linux64", "windows64"):
        raise SystemExit(f"unsupported SDK platform: {platform}")
    folder = pathlib.Path(target).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(DIST + "index.json", timeout=45) as source:
        index = json.load(source)
    expected_name = f"cef_binary_{VERSION}_{platform}_minimal.tar.bz2"
    matches = [
        item for v in index[platform]["versions"]
        for item in v.get("files", [])
        if item.get("name") == expected_name and item.get("type") == "minimal"
    ]
    if len(matches) != 1:
        raise SystemExit(f"pinned SDK archive not in upstream index: {expected_name}")
    expected = matches[0]
    if not re.fullmatch(r"[0-9a-fA-F]{40}", expected.get("sha1", "")):
        raise SystemExit("upstream checksum missing")
    archive = folder / expected_name
    url = DIST + urllib.parse.quote(expected_name, safe="+")
    for attempt in range(1, 4):
        try:
            request = urllib.request.Request(url, headers={"Accept-Encoding": "identity"})
            with urllib.request.urlopen(request, timeout=90) as source:
                with archive.open("wb") as out:
                    shutil.copyfileobj(source, out, length=1024 * 1024)
            with archive.open("rb") as source:
                sha1 = hashlib.file_digest(source, "sha1").hexdigest()
                source.seek(0)
                sha256 = hashlib.file_digest(source, "sha256").hexdigest()
            size = archive.stat().st_size
            if (sha1 == expected["sha1"].lower() and sha256 == SHA256[platform] and
                    size == expected["size"]):
                break
            print(f"SDK attempt {attempt}: received {size}/{expected['size']} bytes; "
                  "expected archive integrity did not match", file=sys.stderr)
        except (OSError, http.client.HTTPException) as error:
            print(f"SDK attempt {attempt}: {type(error).__name__}", file=sys.stderr)
        archive.unlink(missing_ok=True)
        if attempt < 3:
            time.sleep(attempt * 3)
    else:
        raise SystemExit("SDK archive did not match pinned integrity")
    with tarfile.open(archive) as tar:
        tar.extractall(folder, filter="data")
    archive.unlink()
    found = [d for d in folder.glob("cef_binary_*") if d.is_dir()]
    if len(found) != 1 or not (found[0] / "cmake" / "FindCEF.cmake").is_file():
        raise SystemExit("Unexpected CEF SDK layout")
    print(f"CEF archive SHA256: {sha256}", file=sys.stderr)
    print(found[0].as_posix())


if __name__ == "__main__":
    main()
