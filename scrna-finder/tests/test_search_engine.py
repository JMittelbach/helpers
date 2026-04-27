import unittest
from unittest.mock import patch

from scrna_finder.models import DatasetRecord
from scrna_finder.search_engine import normalize_sources, search_datasets, search_datasets_report


class SearchEngineTests(unittest.TestCase):
    def test_normalize_sources_defaults_to_all(self) -> None:
        self.assertEqual(normalize_sources(None), ["geo", "sra", "cellxgene"])
        self.assertEqual(normalize_sources([]), ["geo", "sra", "cellxgene"])

    def test_normalize_sources_deduplicates(self) -> None:
        self.assertEqual(normalize_sources(["geo", "sra", "geo", "cellxgene"]), ["geo", "sra", "cellxgene"])

    def test_normalize_sources_rejects_unknown(self) -> None:
        with self.assertRaises(RuntimeError):
            normalize_sources(["geo", "arrayexpress"])

    def test_search_datasets_combines_selected_sources(self) -> None:
        geo_record = DatasetRecord(
            source="GEO",
            accession="GSE1",
            title="single-cell dataset",
            summary="x",
            organism="Homo sapiens",
            pubdate="2021",
            n_samples=10,
            relevance_score=0.8,
            geo_url="http://geo",
            supplementary_dir="http://geo",
            user_query="q",
        )
        sra_record = DatasetRecord(
            source="SRA",
            accession="SRP1",
            title="single-cell dataset",
            summary="y",
            organism="Homo sapiens",
            pubdate="2022",
            n_samples=20,
            relevance_score=0.9,
            geo_url="http://sra",
            supplementary_dir="",
            user_query="q",
        )
        with patch("scrna_finder.search_engine.search_geo_series", return_value=[geo_record]), patch(
            "scrna_finder.search_engine.search_sra_projects", return_value=[sra_record]
        ), patch(
            "scrna_finder.search_engine.search_cellxgene_datasets", return_value=[]
        ), patch("scrna_finder.search_engine.enrich_records_with_pubmed") as enrich_mock:
            records = search_datasets(
                user_query="q",
                sources=["geo", "sra"],
                include_literature=True,
                papers_per_dataset=3,
            )

        self.assertEqual([r.source for r in records], ["SRA", "GEO"])
        enrich_mock.assert_called_once()

    def test_search_datasets_report_continues_if_one_source_fails(self) -> None:
        sra_record = DatasetRecord(
            source="SRA",
            accession="SRP9",
            title="single-cell dataset",
            summary="y",
            organism="Homo sapiens",
            pubdate="2022",
            n_samples=20,
            relevance_score=0.9,
            geo_url="http://sra",
            supplementary_dir="",
            user_query="q",
        )
        with patch("scrna_finder.search_engine.search_geo_series", side_effect=RuntimeError("geo down")), patch(
            "scrna_finder.search_engine.search_sra_projects", return_value=[sra_record]
        ), patch(
            "scrna_finder.search_engine.search_cellxgene_datasets", return_value=[]
        ):
            report = search_datasets_report(user_query="q", sources=["geo", "sra"])

        self.assertEqual(len(report.records), 1)
        self.assertEqual(report.records[0].source, "SRA")
        self.assertTrue(report.warnings)

    def test_search_datasets_report_adds_network_hint_when_all_sources_fail(self) -> None:
        with patch("scrna_finder.search_engine.search_geo_series", side_effect=RuntimeError("network error")), patch(
            "scrna_finder.search_engine.search_sra_projects", side_effect=RuntimeError("nodename nor servname")
        ), patch(
            "scrna_finder.search_engine.search_cellxgene_datasets", side_effect=RuntimeError("timeout")
        ):
            with self.assertRaises(RuntimeError) as ctx:
                search_datasets_report(user_query="pbmc", sources=["geo", "sra", "cellxgene"])

        msg = str(ctx.exception).lower()
        self.assertIn("all selected sources failed", msg)
        self.assertIn("network/dns access appears unavailable", msg)


if __name__ == "__main__":
    unittest.main()
