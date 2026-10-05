import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  buildNpmInstallInvocation,
  buildSafeNpmEnvironment,
  runNpmInstall,
} from "../process-exec.service.js";

function hasKeyCaseInsensitive(env, key) {
  return Object.keys(env).some((k) => k.toUpperCase() === key.toUpperCase());
}

test("Windows ejecuta cmd.exe desde ComSpec y no npm.cmd directamente", () => {
  const env = {
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    SystemRoot: "C:\\Windows",
    PATH: "C:\\Windows\\System32",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
  };

  const invocation = buildNpmInstallInvocation({
    cwd: "C:\\Projects With Spaces\\demo\\backend",
    platform: "win32",
    env,
  });

  assert.equal(invocation.command, env.ComSpec);
  assert.notEqual(invocation.command.toLowerCase(), "npm.cmd");
  assert.deepEqual(invocation.args.slice(0, 5), [
    "/d",
    "/s",
    "/c",
    "npm.cmd",
    "install",
  ]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.cwd, "C:\\Projects With Spaces\\demo\\backend");
});

test("Windows usa SystemRoot como fallback seguro para cmd.exe", () => {
  const invocation = buildNpmInstallInvocation({
    cwd: "C:\\demo\\backend",
    platform: "win32",
    env: { SystemRoot: "D:\\Windows" },
  });

  assert.equal(invocation.command, "D:\\Windows\\System32\\cmd.exe");
  assert.equal(invocation.options.shell, false);
});

test("Linux mantiene ejecucion directa de npm con shell false", () => {
  const invocation = buildNpmInstallInvocation({
    cwd: "/tmp/demo/backend",
    platform: "linux",
    env: { PATH: "/usr/bin" },
  });

  assert.equal(invocation.command, "npm");
  assert.deepEqual(invocation.args, ["install", "--no-audit", "--no-fund"]);
  assert.equal(invocation.options.shell, false);
});

test("buildSafeNpmEnvironment conserva variables minimas para npm en Windows y filtra SCAFFOLD_PG_*", () => {
  const previous = {};
  const keys = [
    "COMSPEC",
    "SYSTEMROOT",
    "PATH",
    "PATHEXT",
    "TEMP",
    "TMP",
    "APPDATA",
    "LOCALAPPDATA",
    "SCAFFOLD_PG_PASSWORD",
    "SCAFFOLD_PG_HOST",
  ];

  for (const key of keys) {
    previous[key] = process.env[key];
  }

  Object.assign(process.env, {
    COMSPEC: "C:\\Windows\\System32\\cmd.exe",
    SYSTEMROOT: "C:\\Windows",
    PATH: "C:\\Windows\\System32",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    TEMP: "C:\\Temp",
    TMP: "C:\\Temp",
    APPDATA: "C:\\Users\\demo\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
    SCAFFOLD_PG_PASSWORD: "secret-password",
    SCAFFOLD_PG_HOST: "localhost",
  });

  try {
    const env = buildSafeNpmEnvironment();

    for (const key of [
      "COMSPEC",
      "SYSTEMROOT",
      "PATH",
      "PATHEXT",
      "TEMP",
      "TMP",
      "APPDATA",
      "LOCALAPPDATA",
    ]) {
      assert.equal(hasKeyCaseInsensitive(env, key), true, `${key} debe conservarse`);
    }

    assert.equal(hasKeyCaseInsensitive(env, "SCAFFOLD_PG_PASSWORD"), false);
    assert.equal(hasKeyCaseInsensitive(env, "SCAFFOLD_PG_HOST"), false);
    assert.ok(!Object.values(env).includes("secret-password"));
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});

test("buildSafeNpmEnvironment filtra SCAFFOLD_PG_* tambien desde extraEnv", () => {
  const env = buildSafeNpmEnvironment({
    PATH: "C:\\Windows\\System32",
    SCAFFOLD_PG_PASSWORD: "extra-secret",
    SCAFFOLD_PG_HOST: "localhost",
  });

  assert.equal(env.PATH, "C:\\Windows\\System32");
  assert.equal(hasKeyCaseInsensitive(env, "SCAFFOLD_PG_PASSWORD"), false);
  assert.equal(hasKeyCaseInsensitive(env, "SCAFFOLD_PG_HOST"), false);
  assert.ok(!Object.values(env).includes("extra-secret"));
});

test("runNpmInstall no produce spawn EINVAL con la estrategia Windows", async () => {
  const calls = [];
  const fakeExecFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();

    setImmediate(() => {
      child.emit("exit", 0);
      callback(null, "ok", "");
    });

    return child;
  };

  const result = await runNpmInstall({
    cwd: "C:\\Projects With Spaces\\demo\\backend",
    platform: "win32",
    execFileImpl: fakeExecFile,
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /cmd\.exe$/i);
  assert.notEqual(calls[0].command.toLowerCase(), "npm.cmd");
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].args.slice(0, 5), ["/d", "/s", "/c", "npm.cmd", "install"]);
  assert.ok(!String(result.errorMessage || "").includes("spawn EINVAL"));
});

test("runNpmInstall termina el arbol de procesos en Windows al vencer el timeout", async () => {
  const calls = [];
  let npmCallback = null;
  let npmChild = null;

  const fakeExecFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();

    if (/taskkill\.exe$/i.test(command)) {
      assert.deepEqual(args, ["/pid", "4321", "/t", "/f"]);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);

      setImmediate(() => {
        callback(null, "", "");
        npmChild.emit("exit", null);
        const error = new Error("Command failed: timeout");
        error.killed = true;
        error.signal = "SIGTERM";
        npmCallback(error, "", "timed out");
      });

      return child;
    }

    npmChild = child;
    npmChild.pid = 4321;
    npmCallback = callback;
    return npmChild;
  };

  const result = await runNpmInstall({
    cwd: "C:\\Projects With Spaces\\demo\\backend",
    platform: "win32",
    timeoutMs: 1,
    execFileImpl: fakeExecFile,
  });

  assert.equal(result.success, false);
  assert.equal(result.timedOut, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].command, /cmd\.exe$/i);
  assert.match(calls[1].command, /taskkill\.exe$/i);
  assert.equal(calls[1].options.shell, false);
});
