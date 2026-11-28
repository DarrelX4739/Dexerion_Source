"""Opt-in, disposable single-page RAM diagnostic; neither product nor Edge parity."""
import argparse
import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import platform
import re
import secrets
import statistics
import subprocess
import sys
import tempfile
import threading
import time

import psutil

MIB = 1024 * 1024
METRICS = ("rss_mib", "uss_mib", "pss_mib", "private_commit_mib")
ORDER = ("electron", "cef", "cef", "electron")
# No external resources, animation, variable fonts, timers or real user content.
# A second two-frame proof after measurement catches renderer loss/backgrounding.
HTML = b'''<!doctype html><meta charset=utf-8><title>Dexerion footprint fixture</title>
<style>body{margin:0;background:#fff}main{box-sizing:border-box;width:640px;height:360px;
padding:24px;border:1px solid #345;color:#123;font:18px sans-serif}</style>
<main><h1>Native footprint fixture</h1><p>One static document, one active tab.</p></main>
<script>
async function frame(){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
function phase(name){return fetch('phase/'+name,{keepalive:true}).catch(()=>{});}
async function proof(step){
  await frame();if(document.visibilityState!=='visible'){await phase('hidden');throw new Error('fixture not visible');}
  const el=document.querySelector('main'),rect=el.getBoundingClientRect();
  await fetch('proof/'+step,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,ua:navigator.userAgent,
    box:[rect.width,rect.height],title:document.title,heading:el.querySelector('h1').textContent,
    text:el.querySelector('p').textContent})});
}
(async()=>{await phase('script');await proof('start');await fetch('hold');await proof('end')})()
.catch(()=>phase('error'));
</script>'''


def validated_render(data):
    """Accept only the expected visible, fully-sized synthetic DOM and Chromium UA."""
    if not all(isinstance(data[k], (int, float)) and 0 < data[k] < 25000
               for k in ("width", "height", "dpr")):
        raise ValueError("invalid viewport")
    if (data["box"] != [640, 360] or data["title"] != "Dexerion footprint fixture" or
            data["heading"] != "Native footprint fixture" or
            data["text"] != "One static document, one active tab." or
            data["width"] < 640 or data["height"] < 360):
        raise ValueError("fixture DOM area/text changed or does not fit viewport")
    chrom = re.search(r"\bChrome/(\d+(?:\.\d+){0,3})\b", data["ua"])
    if not chrom:
        raise ValueError("missing Chromium UA")
    result = {k: data[k] for k in ("width", "height", "dpr", "box")}
    result["reported_chromium"] = chrom.group(1)
    return result


@contextlib.contextmanager
def fixture():
    key = "/" + secrets.token_urlsafe(24) + "/"
    ready, release, final = (threading.Event() for _ in range(3))
    observed = {"loads": 0, "starts": 0, "ends": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def reply(self, status, body=b"", mime="text/plain"):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_GET(self):
            for name in ("script", "hidden", "error"):
                if self.path == key + "phase/" + name:
                    observed[name] = observed.get(name, 0) + 1
                    return self.reply(204)
            if self.path == key:
                observed["loads"] += 1
                return self.reply(200, HTML, "text/html; charset=utf-8")
            if self.path == key + "hold":
                return self.reply(204 if release.wait(45) else 408)
            self.reply(404)

        def do_POST(self):
            if self.path not in {key + "proof/start", key + "proof/end"}:
                return self.reply(404)
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= 4096:
                    raise ValueError("invalid proof size")
                data = json.loads(self.rfile.read(size))
                proof = validated_render(data)
                step = self.path.rsplit("/", 1)[-1]
                if step == "end" and not release.is_set():
                    raise ValueError("premature end proof")
                observed[step + "s"] += 1
                observed[step] = proof
                self.reply(204)
                (ready if step == "start" else final).set()
            except (KeyError, TypeError, ValueError) as error:
                # Only fixed, non-sensitive fixture diagnostic labels.
                observed["rejected_proofs"] = observed.get("rejected_proofs", 0) + 1
                safe_reasons = {"invalid viewport", "missing Chromium UA", "premature end proof",
                                "invalid proof size", "fixture DOM area/text changed or does not fit viewport"}
                observed["last_rejection"] = str(error) if str(error) in safe_reasons else "invalid fixture payload"
                if "data" in locals() and isinstance(data, dict):
                    observed["rejected_metrics"] = {k: data[k] for k in ("width", "height", "dpr")
                                                    if isinstance(data.get(k), (int, float))}
                self.reply(400)

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield (f"http://127.0.0.1:{server.server_port}{key}", ready, release, final, observed)
        finally:
            release.set()
            server.shutdown()
            thread.join(timeout=2)


def stable_tree(root):
    if not root.is_running():
        raise RuntimeError("browser exited")
    return {root, *root.children(recursive=True)}


def read_sample(root, known):
    """Never publish an incomplete sum. Optional unavailable metrics are null."""
    before = stable_tree(root)
    known.update(before)
    totals = {k: 0 for k in METRICS}
    for p in before:
        info = p.memory_info()  # Required RSS/working set for every descendant.
        if info.rss <= 0:
            raise RuntimeError("zero resident counter")
        try:
            full = p.memory_full_info()
        except (psutil.AccessDenied, PermissionError, NotImplementedError):
            full = None
        values = (info.rss, getattr(full, "uss", None), getattr(full, "pss", None),
                  getattr(info, "private", None) if sys.platform == "win32" else None)
        for k, value in zip(METRICS, values):
            if value is None:
                totals[k] = None
            elif totals[k] is not None:
                totals[k] += value
    after = stable_tree(root)
    known.update(after)
    if before != after or len(after) < 2:
        raise RuntimeError("unstable or missing multiprocess tree")
    return {"processes": len(after), **{k: round(v / MIB, 3) if v is not None else None
                                        for k, v in totals.items()}}


def shutdown(proc, root, known):
    """Stop only launch-owned Process identities; psutil protects against PID reuse."""
    try:
        if root.is_running():
            known.update(root.children(recursive=True))
    except psutil.NoSuchProcess:
        pass
    # Keep existing handles to all observed descendants even if they reparent.
    if proc.poll() is None:
        try:
            root.terminate()
        except psutil.NoSuchProcess:
            pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
    def live(p):
        try:
            return p.is_running() and p.status() != psutil.STATUS_ZOMBIE
        except psutil.NoSuchProcess:
            return False
    for p in known:
        if live(p):
            try:
                p.kill()
            except psutil.NoSuchProcess:
                pass
    proc.wait(timeout=5)
    until = time.monotonic() + 4
    while any(live(p) for p in known) and time.monotonic() < until:
        time.sleep(0.05)
    if any(live(p) for p in known):
        raise RuntimeError("owned process was still alive after cleanup")


def seed_electron(profile, url):
    # Seed only generated disposable data; don't launch with a URL argument,
    # which would create an extra tab next to the restored new-tab page.
    (profile / "tabs.json").write_text(json.dumps({"windows": [
        {"accountId": "default", "activeIndex": 0, "tabs": [{"url": url, "unverified_seed": True}], "groups": []}
    ]}), encoding="utf-8")
    (profile / "settings.json").write_text(json.dumps({"welcomeDaily": False, "restoreSession": True}),
                                          encoding="utf-8")


def request_electron_window_close(proc):
    """Post an ordinary window close only to the launched browser's one window."""
    if proc.poll() is not None:
        raise RuntimeError("Electron exited before the final session verification")
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        user = ctypes.WinDLL("user32", use_last_error=True)
        cb_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user.EnumWindows.argtypes = [cb_type, wintypes.LPARAM]
        user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        user.IsWindowVisible.argtypes = [wintypes.HWND]
        user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        targets = []
        @cb_type
        def visit(hwnd, _):
            pid = wintypes.DWORD()
            user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value == proc.pid and user.IsWindowVisible(hwnd):
                name = ctypes.create_unicode_buffer(256)
                user.GetClassNameW(hwnd, name, len(name))
                if name.value == "Chrome_WidgetWin_1":
                    targets.append(hwnd)
            return True
        if not user.EnumWindows(visit, 0) or len(targets) != 1:
            raise RuntimeError("could not identify exactly one owned Electron window")
        if not user.PostMessageW(targets[0], 0x0010, 0, 0):  # WM_CLOSE
            raise RuntimeError("could not request a graceful Electron window close")
    else:
        # python-xlib on the disposable CI X display; no window manager required.
        from Xlib import X, Xatom, display, error
        from Xlib.protocol import event
        d = display.Display()
        try:
            pid_atom = d.intern_atom("_NET_WM_PID"); delete = d.intern_atom("WM_DELETE_WINDOW")
            targets, pending = [], list(d.screen().root.query_tree().children)
            while pending:
                w = pending.pop()
                try:
                    value = w.get_full_property(pid_atom, Xatom.CARDINAL)
                    if (value is not None and list(value.value) == [proc.pid] and
                            w.get_attributes().map_state == X.IsViewable and
                            delete in (w.get_wm_protocols() or [])):
                        targets.append(w)
                    else:
                        pending.extend(w.query_tree().children)
                except error.BadWindow:
                    continue
            if len(targets) != 1:
                raise RuntimeError("could not identify exactly one owned Electron X11 window")
            win = targets[0]
            win.send_event(event.ClientMessage(window=win,
                client_type=d.intern_atom("WM_PROTOCOLS"), data=(32, [delete, X.CurrentTime, 0, 0, 0])))
            d.sync()
        finally:
            d.close()
    if proc.wait(timeout=12) != 0:
        raise RuntimeError("Electron did not exit cleanly after its window closed")


def verify_saved_tabs(profile, url):
    rows = json.loads((profile / "tabs.json").read_text(encoding="utf-8-sig"))["windows"]
    if len(rows) != 1 or rows[0].get("activeIndex") != 0 or len(rows[0]["tabs"]) != 1:
        raise RuntimeError("Electron did not save exactly one active browser tab")
    tab = rows[0]["tabs"][0]
    if (tab.get("url") != url or tab.get("title") != "Dexerion footprint fixture" or
            "unverified_seed" in tab):
        raise RuntimeError("Electron did not confirm the loaded fixture in its own session snapshot")


def wait_proof(event, proc, root, known, timeout):
    until = time.monotonic() + timeout
    while not event.wait(0.15):
        if proc.poll() is not None:
            raise RuntimeError(f"browser exited before fixture proof ({proc.returncode})")
        if time.monotonic() > until:
            raise RuntimeError("timed out waiting for visible renderer fixture proof")
        known.update(stable_tree(root))


def trial(kind, args, build_dir):
    with tempfile.TemporaryDirectory(prefix="dex-native-footprint-") as scratch, fixture() as fx:
        url, ready, release, final, observed = fx
        profile = Path(scratch) / "profile"
        profile.mkdir()
        env = os.environ.copy()
        if kind == "electron":
            seed_electron(profile, url)
            # The source-tree dependency location is registered by Dexerion in
            # test mode; no Chromium automation, debugging or GPU flags are used.
            env["DEX_AI_TEST"] = "1"
            cmd = [str(args.electron), ".", "--user-data-dir=" + str(profile)]
            cwd = build_dir
        else:
            cmd = [str(args.cef), "--spike-profile-dir=" + str(profile), "--url=" + url]
            cwd = args.cef.parent
        console = Path(scratch) / "browser.log"
        with console.open("wb") as log:
            proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                    stdout=log, stderr=subprocess.STDOUT,
                                    start_new_session=os.name != "nt")
            root = psutil.Process(proc.pid)
            known = {root}
            try:
                wait_proof(ready, proc, root, known, 55)
                time.sleep(args.settle)
                samples = []
                retries = 0
                while len(samples) < args.samples:
                    try:
                        samples.append(read_sample(root, known))
                    except (psutil.NoSuchProcess, psutil.AccessDenied, RuntimeError):
                        retries += 1
                        if retries > 5:
                            raise RuntimeError("could not get complete, stable RSS snapshots")
                    time.sleep(0.35)
                release.set()
                wait_proof(final, proc, root, known, 12)
                if tuple(observed[k] for k in ("loads", "starts", "ends")) != (1, 1, 1):
                    raise RuntimeError("expected exactly one fixture load and one pair of frame proofs")
                if observed["start"] != observed["end"]:
                    raise RuntimeError("viewport or runtime changed during samples")
                if kind == "electron":
                    request_electron_window_close(proc)
                    verify_saved_tabs(profile, url)
            except Exception:
                print(kind + " fixture diagnostic: " + json.dumps(observed), file=sys.stderr)
                log.flush()
                print(kind + " stderr tail:", console.read_bytes()[-2000:].decode(errors="replace"),
                      file=sys.stderr)
                raise
            finally:
                release.set()
                shutdown(proc, root, known)
        return {"arm": kind, "renderer": observed["start"], "two_visible_frame_proofs": True,
                "fixture_loads": observed["loads"],
                "workload_check": "canonical one-window/one-tab saved session" if kind == "electron"
                                  else "one BrowserView by construction and exactly one verified page load",
                "samples": samples, "unstable_samples_retried": retries, "median": summarize(samples)}


def summarize(rows):
    return {k: round(statistics.median(row[k] for row in rows), 3)
            if all(row[k] is not None for row in rows) else None for k in METRICS}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cef", required=True, type=Path)
    p.add_argument("--electron", required=True, type=Path)
    p.add_argument("--output", type=Path)
    p.add_argument("--samples", type=int, default=5, choices=range(3, 10))
    p.add_argument("--settle", type=int, default=3, choices=range(2, 11))
    args = p.parse_args()
    if sys.platform not in {"linux", "win32"}:
        p.error("supported platforms: desktop Linux and Windows")
    if sys.platform == "linux" and not os.environ.get("DISPLAY"):
        p.error("use a graphical session (xvfb-run on a headed CI runner)")
    args.cef = args.cef.resolve(strict=True)
    args.electron = args.electron.resolve(strict=True)
    if args.cef == args.electron:
        p.error("the two executable paths must differ")
    build_dir = Path(__file__).resolve().parents[2] / "code/build"
    if not (build_dir / "package.json").is_file():
        p.error("run the script from the experiment checkout with code/build present")
    trials = []
    for kind in ORDER:
        print(f"Sampling {kind} ({len(trials) + 1}/{len(ORDER)})", file=sys.stderr, flush=True)
        trials.append(trial(kind, args, build_dir))
    med = {a: summarize([t["median"] for t in trials if t["arm"] == a]) for a in set(ORDER)}
    delta = {k: round(med["cef"][k] - med["electron"][k], 3)
             if None not in (med["cef"][k], med["electron"][k]) else None for k in METRICS}
    report = {"scope": "one static loopback page; NOT feature-equivalent; NOT an Edge comparison",
              "fixture_sha256": hashlib.sha256(HTML).hexdigest(),
              "platform": platform.platform(), "psutil": psutil.__version__, "order": list(ORDER),
              "samples_per_arm_per_launch": args.samples, "settle_seconds_after_renderer_proof": args.settle,
              "definitions": {"rss_mib": "summed working set/RSS; shared pages can be counted more than once",
                              "uss_mib": "summed unique resident pages (if accessible for every process)",
                              "pss_mib": "Linux proportional resident bytes (if fully accessible)",
                              "private_commit_mib": "Windows private commit, not resident memory"},
              "notes": ["Root process plus recursive descendants per snapshot; not a system-wide accounting.",
                        "Chromium versions, available features and viewports may differ; see renderer proofs.",
                        "One fixed 640x360 content box; one idle same-origin held request, no telemetry or CDP.",
                        "No inference about browser parity, CPU, GPU, battery or the 20% target."],
              "trials": trials, "median_of_trial_medians_mib": med, "cef_minus_electron_mib": delta}
    output = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    print(output, end="")


if __name__ == "__main__":
    main()
