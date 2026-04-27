import unittest

from scrna_finder.cli import _parse_csv_tokens, _parse_sources_input


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


if __name__ == "__main__":
    unittest.main()
