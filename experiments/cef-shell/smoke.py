"""Start the secured CEF window and prove Chromium rendered a local fixture."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import threading

CASES = {
    "basic": ("Dexerion native CEF fixture", ""),
    "write": ("Dexerion synthetic storage written",
              'localStorage.setItem("dex-spike-key","disposable");'),
    "persist": ("Dexerion synthetic storage persisted",
                'if(localStorage.getItem("dex-spike-key")!=="disposable") throw Error("missing value");'),
    "isolated": ("Dexerion separate profile empty",
                 'if(localStorage.getItem("dex-spike-key")!==null) throw Error("shared value");'),
}


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/jump":
            self.send_response(302)
            self.send_header("Location", "/basic")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        pair = CASES.get(self.path.removeprefix("/"))
        if pair is None:
            self.send_error(404)
            return
        title, operation = pair
        # HTML never supplies the expected title; web JS must actually execute.
        body = ("<!doctype html><meta charset=utf-8><h1>CEF test</h1><script>" +
                operation + "document.title=" + json.dumps(title) + "</script>").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def stop_process(proc):
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                       check=False, capture_output=True, timeout=10)
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    proc.wait(timeout=10)


def launch(executable, profile, url, args, output):
    cmd = [str(executable), f"--spike-profile-dir={profile}", f"--url={url}", *args]
    with output.open("wb") as log:
        proc = subprocess.Popen(cmd, cwd=executable.parent, stdout=log,
                                stderr=subprocess.STDOUT,
                                start_new_session=os.name != "nt")
        try:
            return proc.wait(timeout=65)
        except subprocess.TimeoutExpired:
            stop_process(proc)
            return 124


def prove(executable, scratch, profile, base, case, start=None):
    title = CASES[case][0]
    output = scratch / f"{case}.txt"
    proof = profile / "smoke-result.txt"
    assert not proof.exists(), "old proof must never satisfy a new run"
    options = [f"--smoke-title={title}", "--smoke-proof=smoke-result.txt",
               f"--smoke-final-url={base}/{case}"]
    status = launch(executable, profile, f"{base}/{start or case}", options, output)
    if (status != 0 or not proof.is_file() or
        proof.read_text(encoding="utf-8").splitlines() != ["CEF_RENDERED_FIXTURE", title]):
        print(output.read_text(errors="replace")[-4000:], file=sys.stderr)
        cef_log = profile / "cef.log"
        if cef_log.is_file():
            print(cef_log.read_text(errors="replace")[-5000:], file=sys.stderr)
        raise SystemExit(f"No proof of renderer/committed address completing {case}; exit={status}")
    proof.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=pathlib.Path)
    parser.add_argument("--storage", action="store_true")
    args = parser.parse_args()
    executable = args.executable.resolve(strict=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server, \
         tempfile.TemporaryDirectory(prefix="dexerion-cef-smoke-") as directory:
        scratch = pathlib.Path(directory)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            protected = scratch / "unmarked-nonempty"
            protected.mkdir()
            sentinel = protected / "tabs.json"
            original = b'{"synthetic":"must stay intact"}'
            sentinel.write_bytes(original)
            status = launch(executable, protected, base + "/basic", [], scratch / "negative.txt")
            if status != 2 or sentinel.read_bytes() != original or list(protected.iterdir()) != [sentinel]:
                raise SystemExit("host did not refuse an unmarked nonempty directory safely")
            print("PASS: unmarked nonempty profile refused without writing")
            prove(executable, scratch, scratch / "basic-profile", base, "basic", start="jump")
            print("PASS: native CEF ran sandbox-enabled; renderer title and displayed address agreed after a redirect")
            if args.storage:
                reused = scratch / "same-profile"
                prove(executable, scratch, reused, base, "write")
                prove(executable, scratch, reused, base, "persist")
                prove(executable, scratch, scratch / "unrelated-profile", base, "isolated")
                print("PASS: local storage persisted on restart but was not shared with a separate profile")
        finally:
            server.shutdown()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
