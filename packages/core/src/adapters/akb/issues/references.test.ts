import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../../../agents/tools/__test-helpers__/otelMock";
import { NotFoundError } from "../../../errors";
import {
  addIssueReference,
  listIssueReferences,
  removeIssueReference,
} from "./references";

mockOpenTelemetry();

const VAULT = "reef-acme";
const ISSUE = "REEF-083";
// docUri(vault, issuePathFor(id)) — akb's canonical coll form (a path with a
// directory becomes `/coll/<dir>/doc/<name>`), which link persists and reads match.
const ISSUE_DOC_URI = `akb://${VAULT}/coll/issues/doc/reef-083.md`;
const TARGET = `akb://${VAULT}/coll/overview/doc/spec.md`;

afterEach(() => vi.unstubAllGlobals());

describe("listIssueReferences", () => {
  it("reads outgoing `references` edges and normalizes akb's name → title", async () => {
    const { calls } = setupFetch([
      {
        body: {
          uri: ISSUE_DOC_URI,
          relations: [
            {
              direction: "outgoing",
              relation: "references",
              uri: TARGET,
              resource_type: "doc",
              name: "Server Spec",
            },
          ],
        },
      },
    ]);

    const refs = await listIssueReferences(makeTestAkbAdapter(), VAULT, ISSUE);

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/v1/relations");
    expect(url.searchParams.get("uri")).toBe(ISSUE_DOC_URI);
    expect(url.searchParams.get("type")).toBe("references");
    expect(url.searchParams.get("direction")).toBe("outgoing");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(refs).toEqual([
      { uri: TARGET, title: "Server Spec", resource_type: "doc" },
    ]);
  });

  it("drops non-document reference edges (table/file targets)", async () => {
    setupFetch([
      {
        body: {
          uri: ISSUE_DOC_URI,
          relations: [
            {
              direction: "outgoing",
              relation: "references",
              uri: TARGET,
              resource_type: "doc",
              name: "Spec",
            },
            {
              direction: "outgoing",
              relation: "references",
              uri: `akb://${VAULT}/table/pipeline`,
              resource_type: "table",
              name: "Pipeline",
            },
          ],
        },
      },
    ]);

    const refs = await listIssueReferences(makeTestAkbAdapter(), VAULT, ISSUE);
    expect(refs).toHaveLength(1);
    expect(refs[0].uri).toBe(TARGET);
  });

  it("falls back to a null title when akb resolved no same-vault name", async () => {
    setupFetch([
      {
        body: {
          uri: ISSUE_DOC_URI,
          relations: [
            {
              direction: "outgoing",
              relation: "references",
              uri: TARGET,
              resource_type: "doc",
            },
          ],
        },
      },
    ]);

    const refs = await listIssueReferences(makeTestAkbAdapter(), VAULT, ISSUE);
    expect(refs[0].title).toBeNull();
  });
});

describe("addIssueReference", () => {
  it("POSTs a references edge from the issue document to the target", async () => {
    const { calls } = setupFetch([{ body: {} }]);

    await addIssueReference(makeTestAkbAdapter(), VAULT, ISSUE, TARGET);

    expect(new URL(calls[0].url).pathname).toBe("/api/v1/relations");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      source: ISSUE_DOC_URI,
      target: TARGET,
      relation: "references",
    });
  });

  it("surfaces a 404 from akb as a NotFoundError", async () => {
    setupFetch([{ status: 404, body: { detail: "resource not found" } }]);

    await expect(
      addIssueReference(makeTestAkbAdapter(), VAULT, ISSUE, TARGET),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("removeIssueReference", () => {
  it("DELETEs with source/target/relation as query params, never a body", async () => {
    const { calls } = setupFetch([{ body: {} }]);

    await removeIssueReference(makeTestAkbAdapter(), VAULT, ISSUE, TARGET);

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/v1/relations");
    expect(calls[0].init?.method).toBe("DELETE");
    expect(url.searchParams.get("source")).toBe(ISSUE_DOC_URI);
    expect(url.searchParams.get("target")).toBe(TARGET);
    expect(url.searchParams.get("relation")).toBe("references");
    expect(calls[0].init?.body).toBeUndefined();
  });
});
