import unittest

from scrna_finder.cli import _parse_cell_types_input, _parse_csv_tokens, _parse_sources_input, _sanitize_organism_filter


class CliEasyTests(unittest.TestCase):
    def test_parse_csv_tokens(self) -> None:
        self.assertEqual(_parse_csv_tokens("a,b, c ,,d "), ["a", "b", "c", "d"])
        self.assertEqual(_parse_csv_tokens(""), [])

    def test_parse_sources_input_aliases(self) -> None:
        self.assertEqual(_parse_sources_input("all"), ["geo", "sra", "cellxgene"])
        self.assertEqual(_parse_sources_input("geo,cxg"), ["geo", "cellxgene"])
        self.assertEqual(_parse_sources_input("g,s,c"), ["geo", "sra", "cellxgene"])
        self.assertEqual(_parse_sources_input("1,3"), ["geo", "cellxgene"])

    def test_parse_sources_input_fallback_to_all(self) -> None:
        self.assertEqual(_parse_sources_input("unknown"), ["geo", "sra", "cellxgene"])

    def test_parse_cell_types_input_all_disables_filter(self) -> None:
        self.assertEqual(_parse_cell_types_input("all"), [])
        self.assertEqual(_parse_cell_types_input("all,CD8+ T"), [])

    def test_parse_cell_types_input_list(self) -> None:
        self.assertEqual(_parse_cell_types_input("T-cell,CD8+ T"), ["T-cell", "CD8+ T"])

    def test_sanitize_organism_filter_rejects_yes_no(self) -> None:
        self.assertEqual(_sanitize_organism_filter("yes"), (None, True))
        self.assertEqual(_sanitize_organism_filter("no"), (None, True))

    def test_sanitize_organism_filter_keeps_species(self) -> None:
        self.assertEqual(_sanitize_organism_filter("Homo sapiens"), ("Homo sapiens", False))
        self.assertEqual(_sanitize_organism_filter("none"), (None, False))


if __name__ == "__main__":
    unittest.main()
