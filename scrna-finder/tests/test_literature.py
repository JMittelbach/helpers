import unittest
from unittest.mock import patch

from scrna_finder.literature import enrich_records_with_pubmed
from scrna_finder.models import DatasetRecord
from scrna_finder.ncbi import extract_pubmed_ids


class LiteratureTests(unittest.TestCase):
    def test_extract_pubmed_ids_from_mixed_shapes(self) -> None:
        item = {
            "PubMedIds": [12345678, "34567890"],
            "pmid": "PMID: 99887766",
            "other": "ignore",
        }
        ids = extract_pubmed_ids(item)
        self.assertEqual(ids, ["12345678", "34567890", "99887766"])

    def test_enrich_records_with_latest_paper(self) -> None:
        record = DatasetRecord(
            source="GEO",
            accession="GSE1",
            title="x",
            summary="y",
            organism="Homo sapiens",
            pubdate="2021",
            n_samples=1,
            relevance_score=0.5,
            geo_url="",
            supplementary_dir="",
            user_query="",
            paper_ids="111,222",
            paper_count=2,
        )
        fake_meta = {
            "111": {"title": "Old paper", "pubdate": "2018 Jan", "year": 2018},
            "222": {"title": "New paper", "pubdate": "2024 Dec", "year": 2024},
        }
        with patch("scrna_finder.literature.fetch_pubmed_summaries", return_value=fake_meta):
            enrich_records_with_pubmed([record], papers_per_dataset=5)

        self.assertEqual(record.paper_count, 2)
        self.assertEqual(record.latest_paper_year, 2024)
        self.assertEqual(record.latest_paper_title, "New paper")


if __name__ == "__main__":
    unittest.main()
