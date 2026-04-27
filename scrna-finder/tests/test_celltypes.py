import unittest

from scrna_finder.celltypes import match_cell_types
from scrna_finder.filtering import filter_records
from scrna_finder.models import DatasetRecord


class CellTypeTests(unittest.TestCase):
    def test_variant_labels_match_t_cell(self) -> None:
        text = "Single-cell atlas with CD8+ T cells and activated tcell states."
        matched, hits = match_cell_types(text, ["T-cell"], mode="any")
        self.assertTrue(matched)
        self.assertIn("t cell", hits)

    def test_free_text_term_still_matches(self) -> None:
        text = "Dataset contains cholangiocyte-like populations and hepatocytes."
        matched, hits = match_cell_types(text, ["cholangiocyte"], mode="any")
        self.assertTrue(matched)
        self.assertIn("cholangiocyte", hits)

    def test_all_mode_requires_all_targets(self) -> None:
        text = "Profiling of B cells and fibroblasts."
        matched_any, _ = match_cell_types(text, ["b cell", "t cell"], mode="any")
        matched_all, _ = match_cell_types(text, ["b cell", "t cell"], mode="all")
        self.assertTrue(matched_any)
        self.assertFalse(matched_all)

    def test_filter_records_sets_cell_type_hits(self) -> None:
        records = [
            DatasetRecord(
                source="GEO",
                accession="GSE1",
                title="Tumor dataset with CD4+ T cells",
                summary="single-cell RNA sequencing",
                organism="Homo sapiens",
                pubdate="2022",
                n_samples=12,
                relevance_score=0.8,
                geo_url="http://example",
                supplementary_dir="http://example",
                user_query="tumor",
            ),
            DatasetRecord(
                source="GEO",
                accession="GSE2",
                title="Tumor dataset with epithelial cells",
                summary="single-cell RNA sequencing",
                organism="Homo sapiens",
                pubdate="2022",
                n_samples=9,
                relevance_score=0.75,
                geo_url="http://example",
                supplementary_dir="http://example",
                user_query="tumor",
            ),
        ]
        out = filter_records(records, min_score=0.0, cell_types=["t cell"], cell_mode="any")
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].accession, "GSE1")
        self.assertIn("t cell", out[0].cell_type_hits)

    def test_non_tcell_type_matches_platelet(self) -> None:
        text = "PBMC cohort with platelets and megakaryocytes."
        matched, hits = match_cell_types(text, ["platelet"], mode="any")
        self.assertTrue(matched)
        self.assertIn("platelet", hits)

    def test_typo_is_resolved_for_common_cell_type(self) -> None:
        text = "Single-cell profile with monocytes and dendritic cells."
        matched, hits = match_cell_types(text, ["monoycte"], mode="any")
        self.assertTrue(matched)
        self.assertIn("monocyte", hits)


if __name__ == "__main__":
    unittest.main()
