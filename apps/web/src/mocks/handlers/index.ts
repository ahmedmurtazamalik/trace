import { http, HttpResponse } from "msw";
import { workspaceFixture } from "../fixtures/workspace";
export const handlers = [http.get("*/api/v1/frontend-preview", () => HttpResponse.json(workspaceFixture))];
