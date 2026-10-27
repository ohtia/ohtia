#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
test "$(id -u)" = 0
if test "$OHTIA_NATIVE_PACKAGE_FORMAT:$OHTIA_NATIVE_DISTRIBUTION_PROFILE" = deb:debian-13; then
  verify_debian_profile
  refuse_ubuntu_namespace_allowance
fi
root=/opt/ohtia-native-probe
for item in /opt "$root" "$root/ohtia-native-probe" "$root/resources" "$root/resources/app" "$root/resources/app/native/binding.node"; do
  test ! -L "$item"
  test "$(stat -c %u "$item")" = 0
  writable=$(find "$item" -maxdepth 0 -perm /022 -print)
  test -z "$writable"
done
setid=$(find "$root" -perm /6000 -print)
test -z "$setid"
case "$OHTIA_NATIVE_PACKAGE_FORMAT" in
  deb)
    if test "$OHTIA_NATIVE_DISTRIBUTION_PROFILE" = debian-13; then
      exit 0
    fi
    test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1
    resource="$root/resources/apparmor-profile"
    profile=/etc/apparmor.d/ohtia-native-probe
    test ! -L "$resource"
    test "$(stat -c %u "$resource")" = 0
    test "$(sha256sum "$resource" | cut -d ' ' -f1)" = "$OHTIA_NATIVE_PROFILE_SHA256"
    test ! -L "$profile"
    if test -e "$profile"; then
      test "$(stat -c %u "$profile")" = 0
      cmp "$resource" "$profile"
    fi
    apparmor_parser -Q "$resource"
    install -o root -g root -m 0644 "$resource" "$profile"
    apparmor_parser -r "$profile"
    grep -Fx 'ohtia-native-probe (unconfined)' /sys/kernel/security/apparmor/profiles
    ;;
  rpm)
    test "$(getenforce)" = Enforcing
    restorecon -RF "$root"
    matchpathcon -V "$root/ohtia-native-probe" "$root/resources/app/native/binding.node"
    test "$(getenforce)" = Enforcing
    ;;
  *) exit 1 ;;
esac
