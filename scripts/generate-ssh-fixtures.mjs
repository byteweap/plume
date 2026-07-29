import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(repositoryRoot, "tests/postgres/ssh/generated");
const sshPort = process.env.PLUME_SSH_PORT ?? "55222";
const jumpPort = process.env.PLUME_SSH_JUMP_PORT ?? "55223";
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

function sshKeygen(...args) {
  const result = spawnSync("ssh-keygen", args, { cwd: output, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`ssh-keygen ${args[0]} failed with status ${result.status}`);
  }
}

function publicKey(name) {
  return readFileSync(resolve(output, `${name}.pub`), "utf8")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

sshKeygen("-q", "-t", "ed25519", "-N", "", "-f", "id_ed25519");
sshKeygen(
  "-q",
  "-t",
  "ed25519",
  "-N",
  "plume-key-passphrase",
  "-f",
  "id_ed25519_encrypted",
);
sshKeygen("-q", "-t", "ed25519", "-N", "", "-f", "target_host_key");
sshKeygen("-q", "-t", "ed25519", "-N", "", "-f", "jump_host_key");
sshKeygen("-q", "-t", "ed25519", "-N", "", "-f", "changed_host_key");

writeFileSync(
  resolve(output, "authorized_keys"),
  `${readFileSync(resolve(output, "id_ed25519.pub"), "utf8").trim()}\n${readFileSync(
    resolve(output, "id_ed25519_encrypted.pub"),
    "utf8",
  ).trim()}\n`,
);

const targetKey = publicKey("target_host_key");
const jumpKey = publicKey("jump_host_key");
const changedKey = publicKey("changed_host_key");
writeFileSync(
  resolve(output, "known_hosts"),
  `[localhost]:${sshPort} ${targetKey}\n[localhost]:${jumpPort} ${jumpKey}\nssh-target ${targetKey}\n`,
);
writeFileSync(resolve(output, "known_hosts_unknown"), "");
writeFileSync(
  resolve(output, "known_hosts_changed"),
  `[localhost]:${sshPort} ${changedKey}\n`,
);

for (const file of [
  "id_ed25519",
  "id_ed25519_encrypted",
  "target_host_key",
  "jump_host_key",
  "changed_host_key",
]) {
  chmodSync(resolve(output, file), 0o600);
}
