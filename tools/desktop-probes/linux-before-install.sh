#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
test "$(id -u)" = 0
verify_distribution_profile
if test "$OHTIA_NATIVE_PACKAGE_FORMAT:$OHTIA_NATIVE_DISTRIBUTION_PROFILE" = deb:debian-13; then
  verify_debian_profile
  refuse_ubuntu_namespace_allowance
fi
for item in /opt /opt/ohtia-native-probe; do
  test ! -L "$item"
  if test -e "$item"; then
    test -d "$item"
    test "$(stat -c %u "$item")" = 0
    writable=$(find "$item" -maxdepth 0 -perm /022 -print)
    test -z "$writable"
  fi
done
