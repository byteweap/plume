import { execFileSync } from "node:child_process";

let insideWorkTree = false;

try {
  insideWorkTree =
    execFileSync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() === "true";
} catch {
  console.log("Skipped Git hook setup because this is not a Git worktree.");
}

if (insideWorkTree) {
  try {
    execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
      stdio: "inherit",
    });
    console.log("Configured Git hooks from .githooks/.");
  } catch {
    console.error("Unable to configure the repository-local Git hooks.");
    process.exitCode = 1;
  }
}
