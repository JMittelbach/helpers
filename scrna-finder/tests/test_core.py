import unittest

from scrna_finder.geo import geo_series_supplementary_dir
from scrna_finder.scoring import score_scrna_relevance


class CoreTests(unittest.TestCase):
    def test_geo_supplementary_url(self) -> None:
        url = geo_series_supplementary_dir("GSE12345")
        self.assertEqual(url, "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE12nnn/GSE12345/suppl/")

    def test_scoring_prefers_scrna_over_microarray(self) -> None:
        high = score_scrna_relevance(
            title="Single-cell RNA-seq profiling in human lung",
            summary="10x genomics single-cell transcriptomics data",
            user_query="lung cancer",
        )
        low = score_scrna_relevance(
            title="Microarray dataset of bulk RNA from lung tissue",
            summary="Gene expression profiling by array",
            user_query="lung cancer",
        )
        self.assertGreater(high, low)
        self.assertGreater(high, 0.6)


if __name__ == "__main__":
    unittest.main()
