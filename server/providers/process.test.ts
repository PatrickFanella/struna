import assert from "node:assert/strict";
import { test } from "node:test";

import { appEnv, subscriptionEnv } from "./process.ts";

/** Run `fn` with exactly `env` as the server's environment. */
function withEnv<T>(env: Record<string, string>, fn: () => T): T {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

const SERVER_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/p",
  USER: "p",
  LANG: "en_US.UTF-8",
  LC_ALL: "C.UTF-8",
  TZ: "UTC",
  HTTPS_PROXY: "http://proxy:3128",
  ANTHROPIC_API_KEY: "host-anthropic",
  ANTHROPIC_BASE_URL: "https://host.example",
  CLAUDE_CODE_OAUTH_TOKEN: "host-oauth",
  CLAUDE_CODE_USE_BEDROCK: "1",
  CLAUDECODE: "1",
  OPENAI_API_KEY: "host-openai",
  CODEX_API_KEY: "host-codex",
  CODEX_ACCESS_TOKEN: "host-access",
  CODEX_HOME: "/home/p/.codex-other",
  CLAUDE_CONFIG_DIR: "/home/p/.claude-other",
  AWS_BEARER_TOKEN_BEDROCK: "host-aws",
  AWS_PROFILE: "work",
  AZURE_OPENAI_API_KEY: "host-azure",
  GOOGLE_APPLICATION_CREDENTIALS: "/home/p/gcp.json",
  GUITAR_ROOM_ENDPOINT_KEY: "host-endpoint",
  SOME_SERVICE_PASSWORD: "hunter2",
};

test("subscriptionEnv is unchanged: the key variables go, everything else (the host login folders included) stays", () => {
  assert.deepEqual(
    withEnv(SERVER_ENV, () => subscriptionEnv()),
    {
      PATH: "/usr/bin:/bin",
      HOME: "/home/p",
      USER: "p",
      LANG: "en_US.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      HTTPS_PROXY: "http://proxy:3128",
      CLAUDE_CODE_OAUTH_TOKEN: "host-oauth",
      CODEX_ACCESS_TOKEN: "host-access",
      CODEX_HOME: "/home/p/.codex-other",
      CLAUDE_CONFIG_DIR: "/home/p/.claude-other",
      AWS_BEARER_TOKEN_BEDROCK: "host-aws",
      AWS_PROFILE: "work",
      AZURE_OPENAI_API_KEY: "host-azure",
      GOOGLE_APPLICATION_CREDENTIALS: "/home/p/gcp.json",
      GUITAR_ROOM_ENDPOINT_KEY: "host-endpoint",
      SOME_SERVICE_PASSWORD: "hunter2",
      NO_COLOR: "1",
    },
  );
});

test("appEnv keeps only the allowlist and adds exactly the chosen variables", () => {
  const env = withEnv(SERVER_ENV, () => appEnv({ CLAUDE_CONFIG_DIR: "/state/cli/anthropic", ANTHROPIC_API_KEY: "player-key" }));
  assert.deepEqual(env, {
    PATH: "/usr/bin:/bin",
    HOME: "/home/p",
    USER: "p",
    LANG: "en_US.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    HTTPS_PROXY: "http://proxy:3128",
    NO_COLOR: "1",
    CLAUDE_CONFIG_DIR: "/state/cli/anthropic",
    ANTHROPIC_API_KEY: "player-key",
  });
  for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "CODEX_ACCESS_TOKEN", "CODEX_HOME", "AWS_BEARER_TOKEN_BEDROCK", "AWS_PROFILE", "AZURE_OPENAI_API_KEY", "GUITAR_ROOM_ENDPOINT_KEY", "SOME_SERVICE_PASSWORD"]) assert.ok(!(k in env), k);
});
