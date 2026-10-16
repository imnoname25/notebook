#!/bin/sh
# Install in the protected local control directory, use its absolute path in authorized_keys.
# Do not use eval, a login shell, a checkout or a caller-controlled PATH/PYTHONPATH.
set -eu
unset PYTHONPATH PYTHONHOME
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec /usr/bin/python3 -I /mnt/user/appdata/notebook-deploy-control/lib/gateway_entry.py
