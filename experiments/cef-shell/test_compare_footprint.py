"""Non-GUI contract controls. A real browser run is still required for a RAM result."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

import psutil
import compare_footprint as probe


class FootprintChecks(unittest.TestCase):
    def test_render_contract(self):
        data = dict(width=1000, height=640, dpr=1.25, box=[640, 360], title="Dexerion footprint fixture",
                    heading="Native footprint fixture", text="One static document, one active tab.",
                    ua="Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36", secret="not-recorded")
        out = probe.validated_render(data)
        self.assertEqual(out["reported_chromium"], "151.0.0.0"); self.assertNotIn("secret", out)
        for change in ({"box": [638, 360]}, {"text": "wrong"}, {"width": 639}, {"ua": "other"},
                       {"height": 0}, {"title": "not the fixture"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                probe.validated_render({**data, **change})

    def test_only_browser_written_single_tab_can_pass(self):
        url = "http://127.0.0.1:34567/test/"
        with tempfile.TemporaryDirectory() as d:
            base = Path(d); probe.seed_electron(base, url)
            with self.assertRaises(RuntimeError):
                probe.verify_saved_tabs(base, url)  # seed, not actual verification
            good = {"url": url, "title": "Dexerion footprint fixture", "groupId": None}
            def save(tabs, idx=0):
                (base / "tabs.json").write_text(json.dumps({"windows": [{"activeIndex": idx, "tabs": tabs}]}))
            save([good]); probe.verify_saved_tabs(base, url)
            for rows, ix in (([good, good], 0), ([good], 1), ([{**good, "url": url+"x"}], 0),
                             ([{**good, "title": "new tab"}], 0)):
                save(rows, ix)
                with self.assertRaises(RuntimeError): probe.verify_saved_tabs(base, url)

    def test_order_and_optional_totals(self):
        self.assertEqual(probe.ORDER, ("electron","cef","cef","electron"))
        a = {k: 3 for k in probe.METRICS}; b = {k: 5 for k in probe.METRICS}
        b["uss_mib"] = None
        aggregate = probe.summarize([a,b])
        self.assertEqual(aggregate["rss_mib"], 4); self.assertIsNone(aggregate["uss_mib"])

    def test_reads_only_own_tree_and_reaps_children(self):
        child_code = "import time;time.sleep(25)"
        parent_code = f"import sys,subprocess,time;subprocess.Popen([sys.executable,'-c',{child_code!r}]);time.sleep(25)"
        proc = subprocess.Popen([sys.executable, "-c", parent_code])
        root = psutil.Process(proc.pid); known = {root}
        try:
            until = time.monotonic() + 6
            while not root.children() and time.monotonic() < until: time.sleep(.025)
            report = probe.read_sample(root, known)
            self.assertEqual(report["processes"], 2); self.assertGreater(report["rss_mib"], 0)
            self.assertNotIn(psutil.Process(), known)
        finally:
            probe.shutdown(proc, root, known)
        for p in known:
            self.assertFalse(p.is_running() and p.status() != psutil.STATUS_ZOMBIE)


if __name__ == "__main__":
    unittest.main()
