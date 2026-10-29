#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
root=/opt/ohtia-quality
[ -d "$root" ] && [ ! -L "$root" ]
[ "$(stat -c %U "$root")" = root ]
[ -x "$root/ohtia-quality" ] && [ ! -L "$root/ohtia-quality" ]
# Refuse mutable or privileged payloads instead of activating a fallback sandbox.
invalid=$(find "$root" -xdev \( ! -user root -o -perm /6022 \) -print -quit)
[ -z "$invalid" ]
source="$root/resources/apparmor-profile"
[ -f "$source" ] && [ ! -L "$source" ]
apparmor_parser --skip-kernel-load "$source"
policy=/etc/apparmor.d/ohtia-quality
[ ! -L "$policy" ]
[ ! -e "$policy" ] || [ "$(stat -c %U "$policy")" = root ]
install -o root -g root -m 0644 -- "$source" "$policy"
[ -f "$policy" ] && [ ! -L "$policy" ]
[ "$(stat -c %U "$policy")" = root ]
[ "$(stat -c %a "$policy")" = 644 ]
apparmor_parser --replace "$policy"
grep -q '^ohtia-quality ' /sys/kernel/security/apparmor/profiles
