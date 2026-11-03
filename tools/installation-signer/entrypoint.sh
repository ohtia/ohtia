#!/bin/sh
set -eu
ulimit -c 0
umask 077
exec /usr/bin/tini -g -- /usr/bin/node /opt/ohtia/tooling/installation-signing-container.mjs
