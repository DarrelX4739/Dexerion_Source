"""Incremental persistent helper cost only, not browser-system memory or idle power."""
import contextlib
import os
from pathlib import Path
import select
import statistics
import struct
import subprocess
import time


def measure(work, seconds=60, pairs=5):
    # Snapshot process CPU ticks, Linux per-thread scheduled runtime (single-thread helper)
    # and smaps. Reading /proc from an independent observer does not wake the helper.
    def snap(p):
        sub = Path(f"/proc/{p.pid}")
        if len(list((sub / "task").iterdir())) != 1:
            raise RuntimeError("bench requires a single-thread helper")
        fs = (sub / "stat").read_text().rsplit(") ", 1)[1].split()
        rss = {line.split(":", 1)[0]: int(line.split()[1])
               for line in (sub / "smaps_rollup").read_text().splitlines()
               if line.startswith(("Rss:", "Pss:", "Private_Clean:", "Private_Dirty:"))}
        return {"cpuTicks": int(fs[11]) + int(fs[12]),
                "schedRuntimeNs": int((sub / "schedstat").read_text().split()[0]),
                "rssKiB": rss["Rss"], "pssKiB": rss["Pss"],
                "privateResidentKiB": rss["Private_Clean"] + rss["Private_Dirty"]}

    data = (1, 11000, 8000, 5, 2, 1, 1710000099000, 1710000000000, 60000, 180000, 600000)
    raw = {"binary": [], "text": []}
    for i in range(pairs):
        with contextlib.ExitStack() as cleanup:
            workers = {}
            for kind in (("binary", "text") if i % 2 == 0 else ("text", "binary")):
                p = subprocess.Popen([str(work / ("binary_pipe" if kind == "binary" else "pipe"))],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE)
                def close(p=p, kind=kind):
                    if p.poll() is None:
                        try:
                            p.stdin.write(struct.pack("<Q", 0) if kind == "binary" else b"quit\n")
                            p.stdin.flush()
                            p.wait(5)
                        except (BrokenPipeError, subprocess.TimeoutExpired):
                            p.kill(); p.wait(5)
                    p.stdin.close(); p.stdout.close()
                cleanup.callback(close)
                workers[kind] = p
                p.stdin.write(struct.pack("<Q11d", 1, *data) if kind == "binary" else
                              ("batch 1\n" + " ".join(map(str, data)) + "\n").encode())
                p.stdin.flush()
                if not select.select([p.stdout], [], [], 5)[0]:
                    raise TimeoutError("no decision returned")
                values = struct.unpack("<8d", p.stdout.read(64)) if kind == "binary" else tuple(
                    float(v) for v in p.stdout.readline().decode().strip().split(","))
                if len(values) != 8 or values[1] != 60000:
                    raise RuntimeError(f"unexpected warm-up result: {values}")
            time.sleep(.5)  # verification and pipe flush are outside quiet observation
            before = {k: snap(v) for k, v in workers.items()}
            t0 = time.monotonic()
            time.sleep(seconds)
            after = {k: snap(v) for k, v in workers.items()}
            for k in workers:
                raw[k].append({"quietSeconds": time.monotonic() - t0,
                               **{m: after[k][m] for m in ("rssKiB", "pssKiB", "privateResidentKiB")},
                               "cpuTicks": after[k]["cpuTicks"] - before[k]["cpuTicks"],
                               "scheduledNs": after[k]["schedRuntimeNs"] - before[k]["schedRuntimeNs"]})
    return {"freshPairs": pairs, "requestedQuietSec": seconds, "clockTicksPerSec": os.sysconf("SC_CLK_TCK"),
            "scope": "Single-thread persistent helper only, after one validated decision. No Electron host or IPC while quiet.",
            "medians": {k: {m: statistics.median(d[m] for d in runs) for m in runs[0]} for k, runs in raw.items()},
            "maxScheduledNs": {k: max(d["scheduledNs"] for d in runs) for k, runs in raw.items()}}
