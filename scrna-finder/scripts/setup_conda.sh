#!/usr/bin/env bash
set -euo pipefail

if ! command -v conda >/dev/null 2>&1; then
  echo "ERROR: conda not found in PATH."
  exit 1
fi

ENV_NAME="${1:-scrna-finder}"
PYTHON_VERSION="${PYTHON_VERSION:-3.11}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find_env_prefix() {
  local env_name="$1"
  local payload
  local parsed
  local fallback

  if [[ "${env_name}" == */* ]]; then
    printf '%s\n' "${env_name}"
    return 0
  fi

  payload="$(CONDA_NO_PLUGINS=true conda env list --json 2>/dev/null || true)"
  if [[ -z "${payload}" ]]; then
    payload="$(CONDA_NO_PLUGINS=true conda info --envs --json 2>/dev/null || true)"
  fi
  if [[ -z "${payload}" ]]; then
    fallback="$(CONDA_NO_PLUGINS=true conda run -n "${env_name}" python -c 'import sys; print(sys.prefix)' 2>/dev/null | tail -n 1 || true)"
    printf '%s\n' "${fallback}"
    return 0
  fi

  parsed="$(
    python - "${env_name}" "${payload}" <<'PY'
import json
import os
import sys

name = sys.argv[1]
payload = sys.argv[2]
try:
    data = json.loads(payload)
except Exception:
    print("")
    raise SystemExit(0)

envs = data.get("envs", [])
candidates = [p for p in envs if os.path.basename(p.rstrip("/")) == name]
print(candidates[0] if candidates else "")
PY
  )"

  if [[ -n "${parsed}" ]]; then
    printf '%s\n' "${parsed}"
    return 0
  fi

  fallback="$(CONDA_NO_PLUGINS=true conda run -n "${env_name}" python -c 'import sys; print(sys.prefix)' 2>/dev/null | tail -n 1 || true)"
  if [[ -n "${fallback}" ]]; then
    printf '%s\n' "${fallback}"
    return 0
  fi

  for candidate in \
    "${HOME}/.conda/envs/${env_name}" \
    "/opt/homebrew/Caskroom/miniforge/base/envs/${env_name}" \
    "/opt/homebrew/Caskroom/miniforge/base/envs/${env_name}/"; do
    if [[ -x "${candidate%/}/bin/python" ]]; then
      printf '%s\n' "${candidate%/}"
      return 0
    fi
  done

  printf '\n'
}

PREFIX="$(find_env_prefix "${ENV_NAME}")"

if [[ -n "${PREFIX}" && -x "${PREFIX}/bin/python" ]]; then
  echo "Using existing conda env '${ENV_NAME}' at ${PREFIX}"
else
  echo "Creating conda env '${ENV_NAME}' (python=${PYTHON_VERSION})..."
  conda create -n "${ENV_NAME}" -y "python=${PYTHON_VERSION}" >/dev/null
  PREFIX="$(find_env_prefix "${ENV_NAME}")"
fi

if [[ -z "${PREFIX}" || ! -d "${PREFIX}" ]]; then
  echo "ERROR: could not determine conda prefix for env '${ENV_NAME}'."
  echo "Hint: run 'conda env list' and check whether the env exists."
  exit 1
fi

if [[ ! -d "${PREFIX}/bin" ]]; then
  echo "ERROR: env prefix found but '${PREFIX}/bin' is missing."
  exit 1
fi

LAUNCHER="${PREFIX}/bin/scrna-finder"
LAUNCHER_FALLBACK="${REPO_DIR}/scrna-finder"
LAUNCHER_TARGET="${LAUNCHER}"

if ! {
cat > "${LAUNCHER}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH="${REPO_DIR}/src\${PYTHONPATH:+:\${PYTHONPATH}}"
exec python -m scrna_finder.cli "\$@"
EOF
}; then
  echo "WARNING: could not write ${LAUNCHER}, using repo-local launcher instead."
  LAUNCHER_TARGET="${LAUNCHER_FALLBACK}"
  cat > "${LAUNCHER_TARGET}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH="${REPO_DIR}/src\${PYTHONPATH:+:\${PYTHONPATH}}"
exec conda run -n "${ENV_NAME}" python -m scrna_finder.cli "\$@"
EOF
fi

chmod +x "${LAUNCHER_TARGET}"

echo ""
echo "Done."
echo "Use:"
echo "  conda activate ${ENV_NAME}"
if [[ "${LAUNCHER_TARGET}" == "${LAUNCHER}" ]]; then
  echo "  scrna-finder"
else
  echo "  ${LAUNCHER_TARGET}"
fi
