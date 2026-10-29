#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" -eq 0 ]
root=/opt/ohtia-quality
[ -d "$root" ] && [ ! -L "$root" ]
invalid=$(find "$root" -xdev \( ! -user root -o -perm /6022 \) -print -quit)
[ -z "$invalid" ]
[ "$(getenforce)" = Enforcing ]
restorecon -RF "$root"
find "$root" -xdev -exec matchpathcon -V '{}' +
