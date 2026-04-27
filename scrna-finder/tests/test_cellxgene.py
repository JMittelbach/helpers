import unittest
from unittest.mock import patch

from scrna_finder.cellxgene import fetch_cellxgene_dataset_assets, search_cellxgene_datasets


class CellxgeneTests(unittest.TestCase):
    def test_search_cellxgene_datasets_parses_index(self) -> None:
        payload = [
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "Lung single-cell atlas",
                "assay": [{"label": "10x 3' v3"}],
                "tissue": [{"label": "lung"}],
                "disease": [{"label": "lung adenocarcinoma"}],
                "organism": [{"label": "Homo sapiens"}],
                "cell_type": [{"label": "T cell"}],
                "cell_count": 42000,
                "published_at": 1700000000,
                "explorer_url": "https://cellxgene.cziscience.com/e/11111111-1111-1111-1111-111111111111.cxg",
            }
        ]
        with patch("scrna_finder.cellxgene._json_get_with_fallback", return_value=payload):
            records = search_cellxgene_datasets(user_query="lung", max_results=5, scrna_only=True)

        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec.source, "CELLXGENE")
        self.assertEqual(rec.accession, "11111111-1111-1111-1111-111111111111")
        self.assertEqual(rec.n_samples, 42000)
        self.assertIn("Homo sapiens", rec.organism)
        self.assertGreater(rec.relevance_score, 0.3)

    def test_fetch_cellxgene_dataset_assets(self) -> None:
        side_effect = [
            {
                "assets": [
                    {
                        "id": "asset-a",
                        "filename": "dataset.h5ad",
                        "filetype": "H5AD",
                    }
                ]
            },
            {"dataset_id": "d1", "file_size": 10, "url": "https://datasets.cellxgene.cziscience.com/dataset.h5ad"},
        ]
        with patch("scrna_finder.cellxgene._json_get_with_fallback", side_effect=side_effect):
            assets = fetch_cellxgene_dataset_assets("d1")

        self.assertEqual(len(assets), 1)
        self.assertEqual(assets[0]["file_name"], "dataset.h5ad")
        self.assertEqual(assets[0]["file_type"], "H5AD")
        self.assertIn("datasets.cellxgene.cziscience.com", assets[0]["file_url"])


if __name__ == "__main__":
    unittest.main()
