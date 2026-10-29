#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
. /etc/os-release
[ "$ID" = fedora ] && [ "$VERSION_ID" = 44 ]
[ "$(getenforce)" = Enforcing ]
[ ! -L /opt/ohtia-quality ]
