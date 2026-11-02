import { describe, expect, it } from "vitest";
import config from "../src-tauri/tauri.conf.json";

describe("native media CSP", () => {
  it.each(["csp", "devCsp"] as const)("allows Blob waveform reads in %s", policy => {
    const connect = config.app.security[policy].split(";").map(part => part.trim())
      .find(part => part.startsWith("connect-src "));
    expect(connect?.split(/\s+/)).toContain("blob:");
  });
});
