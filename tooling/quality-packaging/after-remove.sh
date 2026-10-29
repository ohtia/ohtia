#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
policy=/etc/apparmor.d/ohtia-quality
profiles=$(cat /sys/kernel/security/apparmor/profiles)
if [ -e "$policy" ]; then
  [ -f "$policy" ] && [ ! -L "$policy" ]
  [ "$(stat -c %U "$policy")" = root ]
  if printf '%s\n' "$profiles" | grep -q '^ohtia-quality '; then
    apparmor_parser --remove "$policy"
  fi
  rm -- "$policy"
fi
profiles=$(cat /sys/kernel/security/apparmor/profiles)
if printf '%s\n' "$profiles" | grep -q '^ohtia-quality '; then exit 1; fi
