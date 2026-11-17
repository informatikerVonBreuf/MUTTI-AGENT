"""Observabilité du worker : attribution des rôles, tags de traces et graphe Studio. Hors ligne."""
import importlib
import json
import unittest
from unittest.mock import patch

from scripts import folio_worker as worker


class ObservabilityTests(unittest.TestCase):
    def test_each_model_call_carries_its_role(self):
        with patch.dict("os.environ", {"FOLIO_MODEL_BRIDGE": "1"}), patch.object(worker, "model_bridge", return_value={"claims": []}) as bridge:
            worker.request_model("system", {"q": 1}, {"type": "OBJECT"}, "verifier")
        self.assertEqual(bridge.call_args.args[-1], "verifier")

    def test_trace_context_keeps_identifiers_only(self):
        job = {"mode": "chat", "question": "Question confidentielle sur Meta",
               "trace": {"runId": "run-1", "threadId": "thread-1", "userRef": "abcdef0123456789", "kind": "chat", "email": "owner@example.test"}}
        metadata, tags = worker.trace_context(job)
        self.assertEqual(metadata, {"run_id": "run-1", "thread_id": "thread-1", "user_id": "abcdef0123456789", "mode": "chat"})
        self.assertIn("user:abcdef0123456789", tags)
        serialized = json.dumps([metadata, tags])
        self.assertNotIn("confidentielle", serialized)
        self.assertNotIn("owner@example", serialized)

    def test_unsafe_trace_values_are_dropped(self):
        metadata, tags = worker.trace_context({"mode": "chat", "trace": {"runId": "x\ny", "threadId": "../../etc", "userRef": "a" * 200}})
        self.assertEqual(metadata, {})
        self.assertEqual(tags, ["folio", "mode:chat"])

    def test_tracing_is_a_no_op_when_disabled(self):
        def function():
            return 1
        with patch.object(worker, "TRACING", False):
            self.assertIs(worker.traced("x")(function), function)

    def test_studio_graph_runs_offline_on_the_local_corpus(self):
        saved = dict(worker.HANDLERS)
        try:
            with patch.object(worker, "event"):
                studio = importlib.import_module("scripts.folio_studio")
                result = studio.graph.invoke({"question": "Meta revenue 2024 advertising"}, {"recursion_limit": 8})["result"]
            self.assertEqual(result["engine"], "langgraph_bounded")
            self.assertTrue(result["claims"])
            self.assertTrue(all(claim["claim"].startswith("[Studio hors ligne]") for claim in result["claims"]))
        finally:
            worker.HANDLERS.clear()
            worker.HANDLERS.update(saved)


if __name__ == "__main__":
    unittest.main()
