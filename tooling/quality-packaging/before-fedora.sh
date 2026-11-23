#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
. /etc/os-release
# The package build prepends OHTIA_FEDORA_VERSION, the release of the profile it was built for.
# Separate commands: under set -e a failed test before && would not stop the script.
[ "$ID" = fedora ]
[ "$VERSION_ID" = "$OHTIA_FEDORA_VERSION" ]
[ "$(getenforce)" = Enforcing ]
[ ! -L /opt/ohtia ]
