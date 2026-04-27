#!/usr/bin/env bash
set -euo pipefail

if ! command -v conda >/dev/null 2>&1; then
  echo "ERROR: conda not found in PATH."
  exit 1
fi

ENV_NAME="${1:-scrna-finder}"
PYTHON_VERSION="${PYTHON_VERSION:-3.11}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Creating/updating conda env '${ENV_NAME}' (python=${PYTHON_VERSION})..."
conda create -n "${ENV_NAME}" -y "python=${PYTHON_VERSION}" >/dev/null

PREFIX="$(conda run -n "${ENV_NAME}" python -c 'import sys; print(sys.prefix)' | tail -n 1)"
if [[ -z "${PREFIX}" ]]; then
  echo "ERROR: could not determine conda prefix for env '${ENV_NAME}'."
  exit 1
fi

LAUNCHER="${PREFIX}/bin/scrna-finder"
cat > "${LAUNCHER}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH="${REPO_DIR}/src\${PYTHONPATH:+:\${PYTHONPATH}}"
exec python -m scrna_finder.cli "\$@"
EOF
chmod +x "${LAUNCHER}"

echo ""
echo "Done."
echo "Use:"
echo "  conda activate ${ENV_NAME}"
echo "  scrna-finder"
