import { describe, expect, it } from "vitest";
import { requestSecurityHeaders } from "./index.ts";

describe("shared state-changing request protocol", () => {
  it("marks bodyless mutations and binary uploads", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(requestSecurityHeaders(method)).toEqual({ "X-AVS-Request": "1" });
    }
  });

  it("leaves reads unmarked", () => {
    expect(requestSecurityHeaders("GET")).toEqual({});
  });
});
