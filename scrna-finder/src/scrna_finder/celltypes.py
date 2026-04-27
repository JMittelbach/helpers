from __future__ import annotations

import difflib
import re

# Canonical cell-type labels with common variants as seen in public metadata.
CELL_TYPE_ALIASES: dict[str, list[str]] = {
    "t_cell": [
        "t cell",
        "t cells",
        "t-cell",
        "tcell",
        "tcells",
        "t lymphocyte",
        "t lymphocytes",
        "cd3 t",
        "cd3 positive t",
        "cd4 t",
        "cd4 positive t",
        "cd8 t",
        "cd8 positive t",
        "helper t",
        "cytotoxic t",
        "regulatory t",
        "treg",
        "th1",
        "th2",
        "th17",
        "tfh",
        "mait",
        "gamma delta t",
        "gd t",
        "naive t",
        "memory t",
        "effector t",
        "activated t",
    ],
    "b_cell": [
        "b cell",
        "b cells",
        "b-cell",
        "bcell",
        "bcells",
        "b lymphocyte",
        "b lymphocytes",
        "cd19 b",
        "cd19 positive b",
        "cd20 b",
        "cd20 positive b",
        "memory b",
        "naive b",
    ],
    "nk_cell": [
        "nk cell",
        "nk cells",
        "natural killer",
        "natural killer cell",
        "nkt",
        "ilc",
        "innate lymphoid cell",
    ],
    "monocyte": [
        "monocyte",
        "monocytes",
        "classical monocyte",
        "non classical monocyte",
        "cd14 monocyte",
        "cd16 monocyte",
        "intermediate monocyte",
    ],
    "macrophage": [
        "macrophage",
        "macrophages",
        "tumor associated macrophage",
        "tam",
        "m1 macrophage",
        "m2 macrophage",
    ],
    "dendritic_cell": [
        "dendritic cell",
        "dendritic cells",
        "dc",
        "cd1c dendritic",
        "plasmacytoid dendritic",
        "pdc",
        "conventional dendritic",
        "cdc1",
        "cdc2",
    ],
    "neutrophil": ["neutrophil", "neutrophils"],
    "eosinophil": ["eosinophil", "eosinophils"],
    "basophil": ["basophil", "basophils"],
    "plasma_cell": ["plasma cell", "plasma cells", "antibody secreting cell"],
    "mast_cell": ["mast cell", "mast cells", "mucosal mast"],
    "epithelial_cell": ["epithelial cell", "epithelial cells", "epithelium"],
    "endothelial_cell": ["endothelial cell", "endothelial cells", "vascular endothelial"],
    "fibroblast": ["fibroblast", "fibroblasts", "myofibroblast", "stromal fibroblast"],
    "pericyte": ["pericyte", "pericytes"],
    "tumor_cell": ["tumor cell", "tumor cells", "malignant cell", "cancer cell", "neoplastic cell"],
    "stem_cell": ["stem cell", "stem cells", "stem-like cell", "pluripotent stem cell", "ipsc"],
    "progenitor_cell": ["progenitor cell", "progenitor cells", "precursor cell"],
    "microglia": ["microglia", "microglial cell"],
    "astrocyte": ["astrocyte", "astrocytes"],
    "oligodendrocyte": ["oligodendrocyte", "oligodendrocytes", "oligo"],
    "hepatocyte": ["hepatocyte", "hepatocytes"],
    "cholangiocyte": ["cholangiocyte", "cholangiocytes", "bile duct cell"],
    "erythrocyte": ["erythrocyte", "erythrocytes", "red blood cell", "rbc"],
    "platelet": ["platelet", "platelets", "thrombocyte", "thrombocytes"],
    "megakaryocyte": ["megakaryocyte", "megakaryocytes", "mk", "megakaryocytic"],
    "immune_cell": ["immune cell", "immune cells", "leukocyte", "white blood cell"],
    "myeloid_cell": ["myeloid cell", "myeloid cells", "myeloid lineage"],
}


def canonical_cell_type_names() -> list[str]:
    return sorted(CELL_TYPE_ALIASES.keys())


def canonical_to_display_name(canonical: str) -> str:
    return canonical.replace("_", " ")


def _normalize(text: str) -> str:
    lowered = text.lower()
    lowered = lowered.replace("+", " positive ")
    lowered = re.sub(r"[\/_\-]+", " ", lowered)
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


_ALIAS_INDEX: dict[str, set[str]] = {}
_TERM_TO_CANONICAL: dict[str, str] = {}
for canonical, aliases in CELL_TYPE_ALIASES.items():
    normalized_aliases = {_normalize(canonical_to_display_name(canonical))}
    normalized_aliases.update(_normalize(x) for x in aliases)
    normalized_aliases = {x for x in normalized_aliases if x}
    _ALIAS_INDEX[canonical] = normalized_aliases
    for alias in normalized_aliases:
        _TERM_TO_CANONICAL[alias] = canonical


def _guess_canonical_from_typo(normalized_term: str) -> str | None:
    """Conservative typo recovery for user-entered cell-type terms."""
    if len(normalized_term) < 4:
        return None

    if normalized_term in _TERM_TO_CANONICAL:
        return _TERM_TO_CANONICAL[normalized_term]

    compact = normalized_term.replace(" ", "")
    for alias, canonical in _TERM_TO_CANONICAL.items():
        alias_compact = alias.replace(" ", "")
        if compact == alias_compact:
            return canonical

    candidates = difflib.get_close_matches(normalized_term, _TERM_TO_CANONICAL.keys(), n=1, cutoff=0.85)
    if not candidates:
        return None
    return _TERM_TO_CANONICAL.get(candidates[0])


def _contains_phrase(normalized_text: str, normalized_phrase: str) -> bool:
    if not normalized_phrase:
        return False

    haystack = f" {normalized_text} "
    needle = f" {normalized_phrase} "
    if needle in haystack:
        return True

    # Handles compact labels such as "tcell" in metadata.
    if len(normalized_phrase) >= 5:
        return normalized_phrase.replace(" ", "") in normalized_text.replace(" ", "")
    return False


def resolve_requested_cell_types(terms: list[str]) -> tuple[set[str], list[str]]:
    canonical_targets: set[str] = set()
    free_text_targets: list[str] = []

    for term in terms:
        normalized = _normalize(term)
        if not normalized:
            continue
        canonical = _TERM_TO_CANONICAL.get(normalized)
        if canonical:
            canonical_targets.add(canonical)
        else:
            guessed = _guess_canonical_from_typo(normalized)
            if guessed:
                canonical_targets.add(guessed)
            else:
                free_text_targets.append(normalized)

    return canonical_targets, free_text_targets


def detect_cell_type_hits(text: str) -> set[str]:
    normalized_text = _normalize(text)
    hits: set[str] = set()
    for canonical, aliases in _ALIAS_INDEX.items():
        if any(_contains_phrase(normalized_text, alias) for alias in aliases):
            hits.add(canonical)
    return hits


def match_cell_types(text: str, requested_terms: list[str], mode: str = "any") -> tuple[bool, list[str]]:
    if not requested_terms:
        return True, []

    canonical_targets, free_text_targets = resolve_requested_cell_types(requested_terms)
    normalized_text = _normalize(text)
    canonical_hits = detect_cell_type_hits(text)

    requested_hits: list[str] = []
    for canonical in sorted(canonical_targets):
        if canonical in canonical_hits:
            requested_hits.append(canonical_to_display_name(canonical))

    free_hits: list[str] = []
    for token in free_text_targets:
        if _contains_phrase(normalized_text, token):
            free_hits.append(token)

    if mode == "all":
        pass_canonical = all(c in canonical_hits for c in canonical_targets)
        pass_free = all(_contains_phrase(normalized_text, token) for token in free_text_targets)
        matched = pass_canonical and pass_free
    else:
        # Default "any"
        matched = bool(requested_hits or free_hits)

    return matched, requested_hits + free_hits
