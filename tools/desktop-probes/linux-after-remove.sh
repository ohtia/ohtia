#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
test "$(id -u)" = 0
test "$OHTIA_NATIVE_PACKAGE_FORMAT" = deb || exit 0
case "${1:-}" in
  upgrade|failed-upgrade|abort-install|abort-upgrade|disappear) exit 0 ;;
  remove|purge) ;;
  *) exit 1 ;;
esac
profile=/etc/apparmor.d/ohtia-native-probe
test ! -L "$profile"
verify_unloaded() {
  if grep -q '^ohtia-native-probe ' /sys/kernel/security/apparmor/profiles; then
    return 1
  else
    test "$?" = 1
  fi
}
if test -e "$profile"; then
  test "$(stat -c %u "$profile")" = 0
  test "$(sha256sum "$profile" | cut -d ' ' -f1)" = "$OHTIA_NATIVE_PROFILE_SHA256"
  # An interrupted profile load can leave the exact file without a loaded policy.
  if grep -q '^ohtia-native-probe ' /sys/kernel/security/apparmor/profiles; then
    apparmor_parser -R "$profile"
  else
    test "$?" = 1
  fi
  verify_unloaded
  rm "$profile"
fi
# Missing files do not establish that the kernel allowance was removed.
# Refuse an unverifiable loaded policy rather than unload an unidentified file.
verify_unloaded
