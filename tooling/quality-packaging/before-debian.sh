#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ]
[ "$(cat /sys/module/apparmor/parameters/enabled)" = Y ]
[ "$(cat /proc/sys/kernel/unprivileged_userns_clone)" = 1 ]
[ ! -e /etc/apparmor.d/ohtia-quality ]
[ ! -L /opt/ohtia-quality ]
