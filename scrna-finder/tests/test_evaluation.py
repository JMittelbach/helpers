import unittest

from scrna_finder.evaluation import run_benchmark


class EvaluationTests(unittest.TestCase):
    def test_run_benchmark_returns_metrics(self) -> None:
        result = run_benchmark(score_threshold=0.5)
        self.assertGreaterEqual(result["n_cases"], 1)
        self.assertGreaterEqual(result["scrna_accuracy"], 0.0)
        self.assertLessEqual(result["scrna_accuracy"], 1.0)
        self.assertIn("rows", result)
        self.assertTrue(result["rows"])


if __name__ == "__main__":
    unittest.main()
