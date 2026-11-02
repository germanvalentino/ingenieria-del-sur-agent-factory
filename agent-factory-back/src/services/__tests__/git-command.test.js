import test from "node:test";
import assert from "node:assert/strict";
import { resolveGitCommand, executeGit } from "../git-command.service.js";

test("non-Windows uses git on PATH", () => {
  assert.equal(resolveGitCommand({}, "linux"), "git");
});
test("configured nonexistent Git path fails clearly", () => {
  assert.throws(() => resolveGitCommand({ AGENT_GIT_PATH: "/nonexistent/git" }, "win32"), /AGENT_GIT_PATH no existe/);
});
test("executes Git without a shell", async () => {
  const result = await executeGit(["--version"]);
  assert.match(result.stdout, /git version/i);
});
