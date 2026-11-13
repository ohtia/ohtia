#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
. /etc/os-release
[ "$ID" = ubuntu ]
[ "$VERSION_ID" = 26.04 ]
[ "$(cat /sys/module/apparmor/parameters/enabled)" = Y ]
command -v apparmor_parser >/dev/null
[ ! -L /opt/ohtia ]
[ ! -e /opt/ohtia ] || [ "$(stat -c %U /opt/ohtia)" = root ]
