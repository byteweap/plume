#!/bin/sh
set -eu

install -m 0600 /plume-tls/server.key "$PGDATA/server.key"
install -m 0644 /plume-tls/server.crt "$PGDATA/server.crt"
install -m 0644 /plume-tls/ca.crt "$PGDATA/ca.crt"

{
  echo "ssl = on"
  echo "ssl_cert_file = 'server.crt'"
  echo "ssl_key_file = 'server.key'"
  echo "ssl_ca_file = 'ca.crt'"
} >> "$PGDATA/postgresql.conf"

{
  echo "local all all trust"
  echo "hostssl all plume_client all cert clientcert=verify-full"
  echo "hostssl all all all scram-sha-256"
  echo "hostnossl all all all reject"
} > "$PGDATA/pg_hba.conf"
