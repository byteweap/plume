#!/bin/sh
set -eu

echo "plume:${PLUME_SSH_PASSWORD:?PLUME_SSH_PASSWORD must be set}" | chpasswd
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
