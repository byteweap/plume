import { chmodSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(repositoryRoot, "tests/postgres/tls/generated");
const fixtureDirectory = resolve(repositoryRoot, "tests/postgres/tls");
mkdirSync(output, { recursive: true });

function openssl(...args) {
  const result = spawnSync("openssl", args, { cwd: output, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`openssl ${args[0]} failed with status ${result.status}`);
  }
}

openssl(
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  "ca.key",
  "-out",
  "ca.crt",
  "-subj",
  "/CN=Plume Test CA",
  "-days",
  "2",
);

openssl(
  "req",
  "-new",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  "server.key",
  "-out",
  "server.csr",
  "-subj",
  "/CN=localhost",
);
openssl(
  "x509",
  "-req",
  "-in",
  "server.csr",
  "-CA",
  "ca.crt",
  "-CAkey",
  "ca.key",
  "-CAcreateserial",
  "-out",
  "server.crt",
  "-days",
  "2",
  "-extfile",
  resolve(fixtureDirectory, "server.ext"),
);
openssl(
  "req",
  "-new",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  "client.key",
  "-out",
  "client.csr",
  "-subj",
  "/CN=plume_client",
);
openssl(
  "x509",
  "-req",
  "-in",
  "client.csr",
  "-CA",
  "ca.crt",
  "-CAkey",
  "ca.key",
  "-CAcreateserial",
  "-out",
  "client.crt",
  "-days",
  "2",
  "-extfile",
  resolve(fixtureDirectory, "client.ext"),
);
openssl(
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  "untrusted-ca.key",
  "-out",
  "untrusted-ca.crt",
  "-subj",
  "/CN=Untrusted Plume Test CA",
  "-days",
  "2",
);

// The container copies this read-only fixture to a mode-0600 server key.
chmodSync(resolve(output, "server.key"), 0o644);
