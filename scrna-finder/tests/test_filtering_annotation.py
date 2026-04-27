import unittest

from scrna_finder.filtering import filter_records
from scrna_finder.models import DatasetRecord


class FilteringAnnotationTests(unittest.TestCase):
    def test_filter_by_annotation_method_and_fine_tcell(self) -> None:
        r1 = DatasetRecord(
            source="CELLXGENE",
            accession="d1",
            title="x",
            summary="y",
            organism="Homo sapiens",
            pubdate="2024",
            n_samples=100,
            relevance_score=0.8,
            geo_url="",
            supplementary_dir="",
            user_query="",
            annotation_methods="seurat; singler",
            annotation_tcell_detail="naive cd4; treg",
            annotation_confidence=0.75,
        )
        r2 = DatasetRecord(
            source="GEO",
            accession="GSE1",
            title="x",
            summary="y",
            organism="Homo sapiens",
            pubdate="2024",
            n_samples=100,
            relevance_score=0.9,
            geo_url="",
            supplementary_dir="",
            user_query="",
            annotation_methods="",
            annotation_tcell_detail="",
            annotation_confidence=0.1,
        )
        out = filter_records(
            [r1, r2],
            min_score=0.0,
            require_annotation=True,
            min_annotation_confidence=0.5,
            annotation_methods=["seurat"],
            require_fine_tcell=True,
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].accession, "d1")


if __name__ == "__main__":
    unittest.main()
