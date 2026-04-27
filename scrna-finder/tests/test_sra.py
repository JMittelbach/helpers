import unittest
from unittest.mock import patch

from scrna_finder.sra import build_sra_query, search_sra_projects


class SraTests(unittest.TestCase):
    def test_build_sra_query_contains_single_cell_clause(self) -> None:
        q = build_sra_query("glioblastoma", scrna_only=True)
        self.assertIn("glioblastoma", q)
        self.assertIn("single cell", q.lower())

    def test_search_sra_projects_parses_records(self) -> None:
        result_payload = {
            "uids": ["1001"],
            "1001": {
                "accession": "SRP123456",
                "title": "Single-cell RNA-seq in tumor microenvironment",
                "summary": "Contains 120 samples from human tumors",
                "organism": "Homo sapiens",
                "createdate": "2023/11/02",
                "n_samples": "120",
                "PubMedIds": ["12345678"],
            },
        }
        with patch("scrna_finder.sra.esearch_ids", return_value=["1001"]), patch(
            "scrna_finder.sra.esummary_result", return_value=result_payload
        ):
            records = search_sra_projects(user_query="tumor", max_results=5)

        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec.source, "SRA")
        self.assertEqual(rec.accession, "SRP123456")
        self.assertEqual(rec.n_samples, 120)
        self.assertEqual(rec.paper_ids, "12345678")
        self.assertEqual(rec.latest_paper_pmid, "12345678")
        self.assertEqual(rec.latest_paper_url, "https://pubmed.ncbi.nlm.nih.gov/12345678/")
        self.assertIn("ncbi.nlm.nih.gov/sra", rec.geo_url)


if __name__ == "__main__":
    unittest.main()
