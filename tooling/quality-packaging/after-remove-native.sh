#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
# Debian and Fedora quality packages do not install or unload an AppArmor allowance.
