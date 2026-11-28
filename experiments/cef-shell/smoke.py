"""Start the real CEF window and require renderer proof from a local fixture."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import threading

TITLE = "Dexerion native CEF fixture"


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/native-cef-proof":
            self.send_error(404)
            return
        # The final title is set by web JS, not supplied as an HTML title.
        body = ("<!doctype html><meta charset=utf-8><h1>CEF test</h1>"
                "<script>document.title=" + repr(TITLE) + "</script>").encode()
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


def main():
    executable = pathlib.Path(sys.argv[1]).resolve(strict=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server, \
         tempfile.TemporaryDirectory(prefix="dexerion-cef-smoke-") as scratch:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            profile = pathlib.Path(scratch) / "profile"
            output = pathlib.Path(scratch) / "console.txt"
            url = f"http://127.0.0.1:{server.server_port}/native-cef-proof"
            cmd = [str(executable), f"--spike-profile-dir={profile}", f"--url={url}",
                   f"--smoke-title={TITLE}", "--smoke-proof=smoke-result.txt"]
            with output.open("wb") as log:
                proc = subprocess.Popen(cmd, cwd=executable.parent, stdout=log,
                                        stderr=subprocess.STDOUT,
                                        start_new_session=os.name != "nt")
                try:
                    exit_code = proc.wait(timeout=65)
                except subprocess.TimeoutExpired:
                    stop_process(proc)
                    exit_code = 124
            proof = profile / "smoke-result.txt"
            if (exit_code != 0 or not proof.is_file() or
                proof.read_text(encoding="utf-8").splitlines() != ["CEF_RENDERED_FIXTURE", TITLE]):
                print(output.read_text(errors="replace")[-4000:], file=sys.stderr)
                cef_log = profile / "cef.log"
                if cef_log.is_file():
                    print(cef_log.read_text(errors="replace")[-5000:], file=sys.stderr)
                raise SystemExit(f"No proof of separate renderer completing fixture; exit={exit_code}")
            print("PASS: native CEF window ran sandbox-enabled, rendered the loopback fixture and closed")
        finally:
            server.shutdown()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
