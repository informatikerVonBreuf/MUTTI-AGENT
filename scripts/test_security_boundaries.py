"""Local regression checks, no API calls and no financial-data requests."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock
from scripts.finance_subprocess import run_finance_query
from scripts.security_paths import contained_path, thread_directory


class FinanceBoundaryTests(unittest.TestCase):
    @patch("scripts.finance_subprocess.subprocess.run")
    def test_question_is_data_and_cannot_become_source(self, run):
        payload = '\"); __import__("os").system("DO_NOT_EXECUTE"); #'
        run.return_value = Mock(returncode=0, stdout="result")
        self.assertEqual(run_finance_query(payload), "result")
        args, kwargs = run.call_args
        self.assertEqual(args[0][1:], ["-m", "scripts.finance_worker"])
        self.assertNotIn(payload, args[0])
        self.assertEqual(json.loads(kwargs["input"]), {"query": payload})
        self.assertFalse(kwargs["shell"])
        self.assertEqual(kwargs["timeout"], 60)

    @patch("scripts.finance_subprocess.subprocess.run")
    def test_invalid_question_does_not_start_process(self, run):
        for value in [None, "  ", "x" * 4001, {"code": "foo"}]:
            with self.assertRaises(ValueError):
                run_finance_query(value)
        run.assert_not_called()

    @patch("scripts.finance_subprocess.subprocess.run", side_effect=subprocess.TimeoutExpired("worker", 60))
    def test_time_limit_returns_controlled_error(self, run):
        self.assertIn("time limit", run_finance_query("Meta results"))


class WorkspaceBoundaryTests(unittest.TestCase):
    def test_relative_paths_and_user_separation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = thread_directory(temporary, "user_a", "chat-1")
            self.assertEqual(contained_path(root, "researcher/notes.md"), root / "researcher" / "notes.md")
            self.assertNotEqual(root, thread_directory(temporary, "user_b", "chat-1"))
            for invalid in ["../user_b", "/absolute", "C:/Windows", "\\\\server\\share", "a/../../escape", "a\\..\\escape", "file:stream", "NUL.txt", "x.", "a/", ""]:
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    contained_path(root, invalid)
            for invalid in ["../user", "user/a", "..", "CON", "a:b"]:
                with self.assertRaises(ValueError):
                    thread_directory(temporary, invalid, "thread")

    def test_symlink_escape_is_denied(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = thread_directory(base / "workspace", "u", "t")
            outside = base / "outside"
            outside.mkdir()
            try:
                (root / "linked").symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("Creating symlinks is not permitted in this Windows session.")
            with self.assertRaises(ValueError):
                contained_path(root, "linked/private.txt")


if __name__ == "__main__":
    unittest.main()
