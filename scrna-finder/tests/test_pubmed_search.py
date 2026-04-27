import unittest
from unittest.mock import patch

from scrna_finder.literature import build_pubmed_query, search_recent_pubmed


class PubMedSearchTests(unittest.TestCase):
    def test_build_pubmed_query_scrna_clause(self) -> None:
        q = build_pubmed_query("pancreas", scrna_only=True)
        self.assertIn("pancreas", q)
        self.assertIn("single-cell", q)

    def test_search_recent_pubmed_parses_esummary(self) -> None:
        payload = {
            "uids": ["111", "222"],
            "111": {"title": "Paper A", "pubdate": "2024 Dec", "source": "Nature"},
            "222": {"title": "Paper B", "pubdate": "2025 Jan", "source": "Cell"},
        }
        with patch("scrna_finder.literature.esearch_ids", return_value=["111", "222"]), patch(
            "scrna_finder.literature.esummary_result", return_value=payload
        ):
            papers = search_recent_pubmed("tumor", max_results=2)

        self.assertEqual(len(papers), 2)
        self.assertEqual(papers[0].pmid, "111")
        self.assertEqual(papers[1].year, 2025)
        self.assertIn("pubmed.ncbi.nlm.nih.gov", papers[0].url)


if __name__ == "__main__":
    unittest.main()
