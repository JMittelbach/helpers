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

    def test_filter_by_lab_manual_alias(self) -> None:
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
            annotation_methods="lab_manual",
            annotation_evidence="manual curation; flow cytometry",
            annotation_tcell_detail="",
            annotation_confidence=0.7,
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
            annotation_methods="seurat",
            annotation_tcell_detail="",
            annotation_confidence=0.8,
        )
        out = filter_records([r1, r2], annotation_methods=["lab"])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].accession, "d1")

    def test_cell_type_all_disables_filter(self) -> None:
        r1 = DatasetRecord(
            source="CELLXGENE",
            accession="d1",
            title="PBMC with T cells",
            summary="y",
            organism="Homo sapiens",
            pubdate="2024",
            n_samples=100,
            relevance_score=0.8,
            geo_url="",
            supplementary_dir="",
            user_query="",
            annotation_methods="",
            annotation_tcell_detail="",
            annotation_confidence=0.2,
        )
        r2 = DatasetRecord(
            source="GEO",
            accession="GSE1",
            title="Fibroblast atlas",
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
            annotation_confidence=0.2,
        )
        out = filter_records([r1, r2], cell_types=["all"])
        self.assertEqual(len(out), 2)

    def test_manual_lab_only_excludes_software_annotated(self) -> None:
        manual_only = DatasetRecord(
            source="CELLXGENE",
            accession="d_manual",
            title="x",
            summary="y",
            organism="Homo sapiens",
            pubdate="2024",
            n_samples=100,
            relevance_score=0.8,
            geo_url="",
            supplementary_dir="",
            user_query="",
            annotation_methods="lab_manual",
            annotation_evidence="manual curation; flow cytometry",
            annotation_tcell_detail="naive cd4",
            annotation_confidence=0.1,
        )
        mixed_manual_software = DatasetRecord(
            source="GEO",
            accession="d_mixed",
            title="x",
            summary="y",
            organism="Homo sapiens",
            pubdate="2024",
            n_samples=100,
            relevance_score=0.9,
            geo_url="",
            supplementary_dir="",
            user_query="",
            annotation_methods="lab_manual; seurat",
            annotation_evidence="manual curation; seurat",
            annotation_tcell_detail="naive cd8",
            annotation_confidence=0.9,
        )
        software_only = DatasetRecord(
            source="SRA",
            accession="d_soft",
            title="x",
            summary="y",
            organism="Homo sapiens",
            pubdate="2024",
            n_samples=100,
            relevance_score=0.7,
            geo_url="",
            supplementary_dir="",
            user_query="",
            annotation_methods="seurat; celltypist",
            annotation_evidence="seurat; celltypist",
            annotation_tcell_detail="naive cd8",
            annotation_confidence=0.9,
        )
        out = filter_records(
            [manual_only, mixed_manual_software, software_only],
            manual_lab_only=True,
            require_fine_tcell=True,
            organism="Homo sapiens",
        )
        self.assertEqual([x.accession for x in out], ["d_manual"])


if __name__ == "__main__":
    unittest.main()
