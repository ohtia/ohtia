#!/usr/bin/env bash
set -euo pipefail

e2e_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
cd -- "$e2e_root"
e2e_profile=config/desktop/linux-e2e.apparmor

cleanup_linux_e2e_policy() {
  e2e_exit_code=$?
  trap - EXIT
  e2e_cleanup_exit=0
  if python3 scripts/linux_e2e.py policy-unused; then
    sudo apparmor_parser --remove --skip-cache "$e2e_profile" || e2e_cleanup_exit=$?
  else
    e2e_cleanup_exit=$?
  fi
  if [ "$e2e_exit_code" -eq 0 ] && [ "$e2e_cleanup_exit" -ne 0 ]; then
    e2e_exit_code=1
  fi
  exit "$e2e_exit_code"
}

python3 scripts/linux_e2e.py policy-check
sudo apparmor_parser --add --skip-cache "$e2e_profile"
trap cleanup_linux_e2e_policy EXIT
if [ "${1:-}" = "--preflight" ]; then
  python3 scripts/linux_e2e.py policy-unused
else
  python3 scripts/linux_e2e.py run --engine docker "$@"
fi
