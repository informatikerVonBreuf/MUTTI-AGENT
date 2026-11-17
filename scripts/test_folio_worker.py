"""Offline tests of the actual LangGraph workflow. No external API calls."""
import unittest
from unittest.mock import patch
from scripts import folio_worker as worker

PASSAGE = {"id": "p1", "text": "Reported revenue was $100 million in 2024.", "year": "2024"}
CLAIM = {"claim": "Le revenu publié est de 100 millions de dollars.", "evidenceId": "p1", "quote": PASSAGE["text"], "sourceYear": "2024"}

class FolioWorkerTests(unittest.TestCase):
    def test_quote_restoration_preserves_original_table_bytes(self):
        text = "Revenue table\r\n| Total revenue  | $ 164,501 |\r\n| Year | 2024 |"
        model_quote = "| Total revenue | $ 164,501 |\n| Year | 2024 |"
        restored = worker.source_quote(model_quote, text)
        self.assertEqual(restored, "| Total revenue  | $ 164,501 |\r\n| Year | 2024 |")
        self.assertIn(restored, text)

    def test_quote_restoration_never_changes_amounts_words_or_signs(self):
        text = "Reported revenue was $100 million. Loss was -20 million."
        for quote in ["Reported revenue was $200 million.", "Reported profit was $100 million.", "Loss was 20 million.", "Loss was −20 million."]:
            self.assertIsNone(worker.source_quote(quote, text))

    def test_actual_langgraph_nodes_execute_in_order_with_checked_evidence(self):
        responses = [{"axes": ["Revenus publiés", "Évolution"]}, {"claims": [dict(CLAIM)]}, {"claims": [dict(CLAIM)]}, {"approvedIndices": [0, 1]}, {"selectedIndices": [0]}]
        with patch.object(worker, "request_model", side_effect=responses) as model, patch.object(worker, "retrieve", return_value={"passages": [PASSAGE]}) as retrieve, patch.object(worker, "event") as event:
            result = worker.run_agents({"question": "Revenus annuels 2024 ?", "context": {}})
        self.assertEqual(result["engine"], "langgraph_bounded")
        self.assertEqual(len(result["claims"]), 1)
        self.assertEqual(result["claims"][0]["claim"], CLAIM["claim"])
        self.assertEqual(result["claims"][0]["axis"], "")
        self.assertEqual(model.call_count, 5)
        self.assertEqual(retrieve.call_count, 2)
        self.assertEqual([(call.args[0], call.args[1]) for call in event.call_args_list], [(agent, state) for agent in ["planner", "researcher", "verifier", "writer"] for state in ["running", "completed"]])

    def test_wrong_quote_and_source_year_are_rejected_before_semantic_call(self):
        for claim in [{**CLAIM, "quote": "invented quote"}, {**CLAIM, "sourceYear": "2023"}, {**CLAIM, "evidenceId": "unknown"}]:
            with self.subTest(claim=claim), patch.object(worker, "request_model") as model:
                with self.assertRaises(worker.WorkerError) as caught:
                    worker.verify_claims("Revenus 2024", [claim], [PASSAGE])
                self.assertEqual(caught.exception.code, "NO_EVIDENCE")
                model.assert_not_called()

    def test_semantic_rejection_abstains(self):
        with patch.object(worker, "request_model", return_value={"approvedIndices": []}):
            with self.assertRaises(worker.WorkerError) as caught:
                worker.verify_claims("Revenus 2024", [CLAIM], [PASSAGE])
            self.assertEqual(caught.exception.code, "NO_EVIDENCE")

    def test_planner_cannot_create_unbounded_tasks(self):
        with patch.object(worker, "request_model", return_value={"axes": ["axis"] * 4}), patch.object(worker, "event"), patch.object(worker, "retrieve") as retrieve:
            with self.assertRaises(worker.WorkerError) as caught:
                worker.run_agents({"question": "Revenus 2024", "context": {}})
            self.assertEqual(caught.exception.code, "INVALID_OUTPUT")
            retrieve.assert_not_called()

    def test_chat_checks_claims_before_returning(self):
        with patch.object(worker, "request_model", side_effect=[{"claims": [dict(CLAIM)]}, {"approvedIndices": [0]}]), patch.object(worker, "retrieve", return_value={"passages": [PASSAGE]}), patch.object(worker, "event") as event:
            result = worker.run_chat({"question": "Revenus 2024", "context": {}})
        self.assertEqual(result["claims"][0]["evidenceId"], "p1")
        self.assertEqual(event.call_args_list[-1].args[:2], ("verifier", "completed"))

    def test_follow_up_question_inherits_previous_company_and_period(self):
        follow_up = "Et quel est le résultat opérationnel sur la même période ?"
        context = {"recentMessages": [
            {"role": "user", "content": "Quel est le chiffre d’affaires total d’Amazon pour l’exercice 2024 ?"},
            {"role": "assistant", "content": "637 959 millions de dollars [1]"},
            {"role": "user", "content": follow_up}]}
        with patch.object(worker, "request_model", side_effect=[{"claims": [dict(CLAIM)]}, {"approvedIndices": [0]}]) as model, patch.object(worker, "retrieve", return_value={"passages": [PASSAGE]}) as retrieve, patch.object(worker, "event"):
            worker.run_chat({"question": follow_up, "context": context})
        query = retrieve.call_args.args[0]
        self.assertTrue(query.startswith(follow_up))
        self.assertIn("Amazon", query)
        self.assertIn("2024", query)
        self.assertIn("Amazon", model.call_args_list[1].args[1]["question"])

    def test_self_contained_question_is_searched_as_asked(self):
        question = "Quel est le chiffre d’affaires de Meta en 2024 ?"
        context = {"recentMessages": [{"role": "user", "content": "Ventes d’Apple en 2023 ?"}, {"role": "user", "content": question}]}
        self.assertEqual(worker.chat_question({"question": question, "context": context}), question)
        self.assertEqual(worker.chat_question({"question": "Et ensuite ?", "context": {}}), "Et ensuite ?")
        self.assertEqual(worker.chat_question({"question": "Et ensuite ?", "context": {"recentMessages": [{"role": "user", "content": "Bonjour"}]}}), "Et ensuite ?")

    def test_writer_cannot_select_an_invented_claim(self):
        responses = [{"axes": ["Revenus"]}, {"claims": [dict(CLAIM)]}, {"approvedIndices": [0]}, {"selectedIndices": [99]}]
        with patch.object(worker, "request_model", side_effect=responses), patch.object(worker, "retrieve", return_value={"passages": [PASSAGE]}), patch.object(worker, "event"):
            with self.assertRaises(worker.WorkerError) as caught:
                worker.run_agents({"question": "Revenus 2024", "context": {}})
            self.assertEqual(caught.exception.code, "INVALID_OUTPUT")

if __name__ == "__main__":
    unittest.main()
