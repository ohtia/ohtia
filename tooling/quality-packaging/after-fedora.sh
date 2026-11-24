#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
root=/opt/ohtia
[ -d "$root" ]
[ ! -L "$root" ]
invalid=$(find "$root" -xdev \( ! -user root -o -perm /6022 \) -print -quit)
[ -z "$invalid" ]
[ "$(getenforce)" = Enforcing ]
restorecon -RF "$root"
# matchpathcon -V prints one "verified." line per correct path; show only mismatches.
if ! labels=$(find "$root" -xdev -exec matchpathcon -V '{}' + 2>&1); then
  printf '%s\n' "$labels" | grep -v ' verified\.$' >&2 || :
  exit 1
fi
