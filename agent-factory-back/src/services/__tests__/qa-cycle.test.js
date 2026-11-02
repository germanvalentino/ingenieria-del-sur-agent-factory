import { blockingQa } from "../selective-context.service.js";
import test from "node:test";
import assert from "node:assert/strict";
import { fingerprintFiles, classifyVerdict, canCorrect, resolveQaClassification, correctionOutcome, classifyCommandFailure, isText, reviewChunks } from "../qa-cycle.service.js";
import { runQaValidation, shouldIncludeReviewFile } from "../qa.service.js";

for (const [output, expected] of [["QA_PASS\nOK", "passed"], ["QA_FAIL\nbug", "functional_failure"], ["", "inconclusive"], ["Mention QA_FAIL", "inconclusive"], ["QA_PASS\nDo not emit QA_FAIL", "passed"]]) {
  test(`verdict ${JSON.stringify(output)}`, () => assert.equal(classifyVerdict(output), expected));
}
for (const classification of ["passed", "functional_failure", "technical_error", "stale", "inconclusive"]) {
  test(`only functional failure starts correction: ${classification}`, () => {
    assert.equal(canCorrect({ classification, active: true, consumed: 0 }), classification === "functional_failure");
    for (const overrides of [{ active: false }, { consumed: 3 }, { fresh: false }]) {
      assert.equal(canCorrect({ classification, active: true, consumed: 0, ...overrides }), false);
    }
  });
}
test("new development invalidates passed and failed QA; stop invalidates active review", () => {
  for (const classification of ["passed", "functional_failure", "technical_error", "inconclusive"]) {
    assert.equal(resolveQaClassification({ classification, sourceExecutionId: "old", latestExecutionId: "new", active: true }).classification, "stale");
    assert.equal(resolveQaClassification({ classification, sourceExecutionId: "same", latestExecutionId: "same", active: false }).classification, "inconclusive");
    assert.equal(resolveQaClassification({ classification, sourceExecutionId: "same", latestExecutionId: "same", active: true }).classification, classification);
  }
});
test("correction without changes stops and spends no attempt", () => {
  assert.deepEqual(correctionOutcome(false), { consumed: 0, classification: "inconclusive", stop: true });
  assert.equal(correctionOutcome(true).consumed, 1);
});
test("commands distinguish infrastructure, modified code and unrelated failures", () => {
  assert.equal(classifyCommandFailure({ script: "npm ci", output: "error" }, ["src/a.js"]), "technical_error");
  assert.equal(classifyCommandFailure({ script: "test", output: "ENOTFOUND src/a.js" }, ["src/a.js"]), "technical_error");
  assert.equal(classifyCommandFailure({ script: "lint", output: "src/a.js:5 SyntaxError" }, ["src/a.js"]), "functional_failure");
  assert.equal(classifyCommandFailure({ script: "test", output: "src/old.js: failed" }, ["src/a.js"]), "inconclusive");
});
test("binary, NUL and invalid UTF8 are not reviewable", () => {
  for (const bytes of [Buffer.from([0, 1]), Buffer.from([255, 254]), Buffer.from("a\u0001")]) assert.equal(isText(bytes), false);
  assert.equal(isText(Buffer.from("c?digo\n")), true);
});
test("large diffs retain every character in bounded groups", () => {
  const diff = "diff --git a/a b/a\n" + "a".repeat(150000) + "\ndiff --git a/b b/b\ntext";
  const groups = reviewChunks(diff);
  assert.ok(groups.length > 1);
  assert.ok(groups.every(group => group.length <= 60000));
  assert.equal(groups.join(""), diff);
});
function fixture(results, outputs = ["QA_PASS"], diff = "diff --git a/a b/a\n+text") {
  let calls = 0;
  const dependencies = {
    fingerprint: async () => "unchanged",
    readStatus: async () => " M src/a.js",
    changedFiles: async () => ["src/a.js"],
    validateProject: async () => ({ results, usingNodeSyntaxCheck: false }),
    readChanges: async () => ({ status: " M src/a.js", diff }),
    assertUnchanged: async () => {},
    review: async () => ({ output: outputs[calls++], usage: { totalTokens: 10 }, costUsd: 0.01 }),
  };
  return { dependencies, calls: () => calls };
}
for (const script of ["node --check", "lint", "test", "build", "npm ci"]) {
  test(`failed ${script} never calls AI`, async () => {
    const fixtureResult = fixture([{ script, status: "failed", output: "src/a.js: invalid syntax" }]);
    const result = await runQaValidation({ workingDirectory: "C:/proyectos/test", dependencies: fixtureResult.dependencies });
    assert.equal(fixtureResult.calls(), 0);
    const correctionContext = blockingQa(result.summary, result.classification);
    if (result.classification === "functional_failure") {
      assert.ok(correctionContext.includes(script));
      assert.ok(correctionContext.includes("src/a.js: invalid syntax"));
    } else {
      assert.equal(correctionContext, "");
    }
    assert.equal(result.classification, script === "npm ci" ? "technical_error" : "functional_failure");
    assert.match(result.summary, new RegExp(script === "node --check" ? "node --check" : script));
  });
}
for (const [output, expected] of [["QA_PASS", "passed"], ["QA_FAIL", "functional_failure"], ["invalid", "inconclusive"]]) {
  test(`successful commands consolidate ${expected}`, async () => {
    const f = fixture([{ script: "test", status: "passed" }], [output]);
    const result = await runQaValidation({ workingDirectory: "C:/proyectos/test", dependencies: f.dependencies });
    assert.equal(result.classification, expected);
    assert.equal(f.calls(), 1);
  });
}
test("group reviews consolidate all results and sum usage", async () => {
  const f = fixture([], ["QA_PASS", "QA_FAIL", "QA_PASS"], "diff --git a/a b/a\n" + "x".repeat(130000));
  const result = await runQaValidation({ workingDirectory: "C:/proyectos/test", dependencies: f.dependencies });
  assert.equal(result.classification, "functional_failure");
  assert.equal(result.aiUsage.totalTokens, 30);
  assert.equal(result.costUsd, 0.03);
  assert.equal(f.calls(), 3);
});

test("provider error midway stops groups and preserves completed usage", async () => {
  const f = fixture([], ["QA_PASS"], "diff --git a/a b/a\n" + "x".repeat(130000));
  let calls = 0;
  f.dependencies.review = async () => {
    calls++;
    if (calls === 2) throw new Error("Provider timeout");
    return { output: "QA_PASS", usage: { totalTokens: 10 } };
  };
  const result = await runQaValidation({ workingDirectory: "C:/proyectos/test", dependencies: f.dependencies });
  assert.equal(result.classification, "technical_error");
  assert.equal(result.aiUsage.totalTokens, 10);
  assert.match(result.reason, /timeout/);
  assert.equal(calls, 2);
  assert.equal(canCorrect({ classification: result.classification, active: true, consumed: 0 }), false);
});
test("stopping between groups skips remaining provider calls", async () => {
  const f = fixture([], ["QA_PASS"], "diff --git a/a b/a\n" + "x".repeat(130000));
  const result = await runQaValidation({ workingDirectory: "C:/proyectos/test", dependencies: f.dependencies,
    shouldContinue: async () => f.calls() === 0 });
  assert.equal(result.classification, "inconclusive");
  assert.equal(f.calls(), 1);
  assert.equal(result.aiUsage.totalTokens, 10);
});
test("review file policy excludes generated and confidential files", () => {
  for (const file of ["node_modules/a.js", "front/dist/a.js", "back/build/a.js", "package-lock.json", ".git/config", ".env", "front/.env.production", "server.key"]) {
    assert.equal(shouldIncludeReviewFile(file), false, file);
  }
  assert.equal(shouldIncludeReviewFile("front/src/App.jsx"), true);
});

test("fingerprint detects content edits even when git status paths stay the same", async () => {
  const files = ["src/a.js", "src/b.js"];
  const before = await fingerprintFiles("repo", files, async () => Buffer.from("before"));
  const unchanged = await fingerprintFiles("repo", [...files].reverse(), async () => Buffer.from("before"));
  const changed = await fingerprintFiles("repo", files, async () => Buffer.from("after"));
  assert.equal(before, unchanged);
  assert.notEqual(before, changed);
});

test("context overflow prevents every provider call and never returns QA_PASS", async () => {
  const f = fixture([], ["QA_PASS"], "diff --git a/a b/a\n" + "x".repeat(250000));
  await assert.rejects(runQaValidation({ workingDirectory: "C:/proyectos/test", dependencies: f.dependencies }), error => error.qaClassification === "technical_error");
  assert.equal(f.calls(), 0);
});
test("non-reviewable source changes block QA approval", async () => {
  const f = fixture([], ["QA_PASS"]);
  f.dependencies.readChanges = async () => ({ diff: "diff --git a/a b/a\n+code", excluded: [{ file: "src/b.js", reason: "binary" }] });
  await assert.rejects(runQaValidation({ workingDirectory: "C:/proyectos/test", dependencies: f.dependencies }), error => error.qaClassification === "technical_error");
  assert.equal(f.calls(), 0);
});
