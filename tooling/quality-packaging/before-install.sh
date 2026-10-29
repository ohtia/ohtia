#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
. /etc/os-release
[ "$ID" = ubuntu ]
case "$VERSION_ID" in 24.04|26.04) ;; *) exit 1 ;; esac
[ "$(cat /sys/module/apparmor/parameters/enabled)" = Y ]
command -v apparmor_parser >/dev/null
[ ! -L /opt/ohtia-quality ]
[ ! -e /opt/ohtia-quality ] || [ "$(stat -c %U /opt/ohtia-quality)" = root ]
