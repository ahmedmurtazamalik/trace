import { describe, expect, it } from "vitest";
import { workspaceFixture } from "./workspace";
describe("workspace fixture", () => { it("is deterministic and explicitly illustrative", () => { expect(workspaceFixture.disclosure).toMatch(/illustrative/i); expect(workspaceFixture.metrics).toHaveLength(4); }); });
