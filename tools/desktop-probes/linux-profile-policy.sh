# Shared read-only checks embedded into each generated native package hook.
verify_distribution_profile() {
  ID=
  VERSION_ID=
  . /etc/os-release
  case "$OHTIA_NATIVE_DISTRIBUTION_PROFILE:$ID:$VERSION_ID" in
    ubuntu-24.04:ubuntu:24.04|ubuntu-26.04:ubuntu:26.04|debian-13:debian:13|fedora-44:fedora:44) ;;
    *) return 1 ;;
  esac
}

verify_debian_profile() {
  ID=
  VERSION_ID=
  . /etc/os-release
  test "$ID:$VERSION_ID" = debian:13
  test "$(cat /sys/module/apparmor/parameters/enabled)" = Y
  test "$(cat /proc/sys/kernel/unprivileged_userns_clone)" = 1
  if test -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns; then
    test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 0
  fi
}

refuse_ubuntu_namespace_allowance() {
  profile=/etc/apparmor.d/ohtia-native-probe
  test ! -L "$profile"
  test ! -e "$profile"
  if grep -q '^ohtia-native-probe ' /sys/kernel/security/apparmor/profiles; then
    return 1
  else
    test "$?" = 1
  fi
}
