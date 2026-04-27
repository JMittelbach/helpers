import argparse
import os
import tempfile
import unittest
from unittest.mock import patch

from scrna_finder.cli import run_list_files
from scrna_finder.io_utils import read_manifest
from scrna_finder.models import DatasetRecord


class CliListFilesTests(unittest.TestCase):
    def test_list_files_supports_cellxgene_assets(self) -> None:
        record = DatasetRecord(
            source="CELLXGENE",
            accession="d1",
            title="dataset",
            summary="",
            organism="Homo sapiens",
            pubdate="2024",
            n_samples=10,
            relevance_score=0.7,
            geo_url="",
            supplementary_dir="",
            user_query="q",
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            out = os.path.join(tmpdir, "files.csv")
            args = argparse.Namespace(
                input="unused.csv",
                out=out,
                max_datasets=20,
                include=[],
                exclude=[],
            )
            with patch("scrna_finder.cli.read_records", return_value=[record]), patch(
                "scrna_finder.cli.fetch_cellxgene_dataset_assets",
                return_value=[
                    {
                        "file_name": "dataset.h5ad",
                        "file_type": "H5AD",
                        "file_url": "https://datasets.cellxgene.cziscience.com/dataset.h5ad",
                    }
                ],
            ):
                code = run_list_files(args)

            self.assertEqual(code, 0)
            rows = read_manifest(out)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["source"], "CELLXGENE")
            self.assertEqual(rows[0]["file_name"], "dataset.h5ad")


if __name__ == "__main__":
    unittest.main()
