import contextlib, io, json, os, sys, tempfile, unittest, urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import firms_ingest as f

KEY = "ABCDEF0123456789ABCDEF0123456789"  # fake, test-only
CSV = ("latitude,longitude,acq_date,confidence,frp\n"
       "1,1,2026-11-03,h,10.5\n2,2,2026-11-03,n,2\n3,3,2026-11-04,l,1\n")


class Resp:
    def __init__(self, body): self.body = body.encode()
    def read(self): return self.body
    def __enter__(self): return self
    def __exit__(self, *a): return False


class FirmsTests(unittest.TestCase):
    def test_missing_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(f.FirmsError):
                f.get_key()

    def test_malformed_key_not_echoed(self):
        with mock.patch.dict(os.environ, {"FIRMS_MAP_KEY": "bad-key-value"}, clear=True):
            with self.assertRaises(f.FirmsError) as c:
                f.get_key()
            self.assertNotIn("bad-key-value", str(c.exception))

    def test_summarize(self):
        d = f.summarize(CSV)
        self.assertEqual(d["2026-11-03"]["detections"], 2)
        self.assertEqual(d["2026-11-03"]["high_confidence"], 1)
        self.assertEqual(d["2026-11-04"]["detections"], 1)

    def test_http_error_does_not_leak_key(self):
        err = urllib.error.HTTPError(f"https://x/{KEY}/a", 403, "Forbidden", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(f.FirmsError) as c:
                f.fetch_csv("VIIRS_NOAA20_NRT", KEY)
        self.assertNotIn(KEY, str(c.exception))

    def test_network_error_retries_then_fails_safely(self):
        err = urllib.error.URLError(f"cannot reach https://x/{KEY}/a")
        with mock.patch("urllib.request.urlopen", side_effect=err), mock.patch("time.sleep"):
            with self.assertRaises(f.FirmsError) as c:
                f.fetch_csv("VIIRS_NOAA20_NRT", KEY, retries=2)
        self.assertNotIn(KEY, str(c.exception))

    def test_non_csv_rejected(self):
        with mock.patch("urllib.request.urlopen", return_value=Resp("Invalid MAP_KEY.")):
            with self.assertRaises(f.FirmsError):
                f.fetch_csv("VIIRS_NOAA20_NRT", KEY)

    def test_full_run_never_prints_key(self):
        buf = io.StringIO()
        with tempfile.TemporaryDirectory() as t, \
             mock.patch.dict(os.environ, {"FIRMS_MAP_KEY": KEY}, clear=True), \
             mock.patch("urllib.request.urlopen", return_value=Resp(CSV)) as uo, \
             contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            out = Path(t) / "o.json"
            self.assertEqual(f.main(out), 0)
            saved = out.read_text()
        self.assertIn(KEY, uo.call_args[0][0])  # key IS used in the request...
        self.assertNotIn(KEY, buf.getvalue())   # ...but never logged
        self.assertNotIn(KEY, saved)            # ...and never written to output
        self.assertIn("VIIRS_NOAA21_NRT", json.loads(saved)["data"])


if __name__ == "__main__":
    unittest.main()
