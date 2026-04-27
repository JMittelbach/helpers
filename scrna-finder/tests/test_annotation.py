import unittest

from scrna_finder.annotation import analyze_annotation_text, annotate_record
from scrna_finder.models import DatasetRecord


class AnnotationTests(unittest.TestCase):
    def test_detects_methods_and_fine_tcell_detail(self) -> None:
        text = (
            "Cell type annotation performed with Seurat label transfer and SingleR. "
            "Fine labels include naive CD4, Treg and exhausted T cells."
        )
        out = analyze_annotation_text(text)
        self.assertIn("seurat", out["methods"])
        self.assertIn("singler", out["methods"])
        self.assertTrue(out["fine_t_hits"])
        self.assertGreaterEqual(float(out["confidence"]), 0.5)

    def test_annotate_record_sets_fields(self) -> None:
        record = DatasetRecord(
            source="CELLXGENE",
            accession="d1",
            title="PBMC atlas",
            summary="Manual annotation using CellTypist and marker genes",
            organism="Homo sapiens",
            pubdate="2024",
            n_samples=1000,
            relevance_score=0.8,
            geo_url="",
            supplementary_dir="",
            user_query="pbmc",
        )
        annotate_record(record)
        self.assertIn("celltypist", record.annotation_methods)
        self.assertGreater(record.annotation_confidence, 0.0)
        self.assertIn(record.annotation_quality_tier, {"low", "medium", "high"})
        self.assertIn("summary", record.annotation_signal_sources)


if __name__ == "__main__":
    unittest.main()
