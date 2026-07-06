import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { AkbWebUrlProvider } from "@/providers/AkbWebUrlProvider";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentRefCard } from "./DocumentRefCard";

// REEF-368: the "open in akb" backlink should be driven by the RUNTIME akb web
// base handed down through AkbWebUrlProvider — the server reads it per request
// and passes it to the client — not a build-time `NEXT_PUBLIC_*` inline that
// silently vanished from a deployed bundle. These render the card with the base
// provided (link shows, correct href) and absent (open action hidden, copy
// available), which is exactly the contract the fix turns on.

const REFERENCE = {
  uri: "akb://myvault/coll/docs/doc/spec.md",
  title: "Spec doc",
} as const;

// buildAkbDocumentUrl(base, uri): base + /vault/<vault>/doc/<encoded coll/slug>.
const EXPECTED_HREF =
  "https://akb.example.com/vault/myvault/doc/docs%2Fspec.md";

function renderCard(akbWebUrl: string | null): void {
  render(
    <IntlTestProvider>
      <AkbWebUrlProvider value={akbWebUrl}>
        <DocumentRefCard reference={REFERENCE} />
      </AkbWebUrlProvider>
    </IntlTestProvider>,
  );
}

describe("DocumentRefCard backlink (REEF-368)", () => {
  it("renders the open link from the runtime akb web base with the correct href", () => {
    renderCard("https://akb.example.com");

    const openLink = screen.getByRole("link", {
      name: "Open document in akb",
    });
    expect(openLink).toHaveAttribute("href", EXPECTED_HREF);
    expect(openLink).toHaveAttribute("target", "_blank");
  });

  it("hides the open action and keeps copy when no runtime base is configured", () => {
    renderCard(null);

    expect(
      screen.queryByRole("link", { name: "Open document in akb" }),
    ).not.toBeInTheDocument();
    // The copy affordance stays so the reference is still usable (the graceful
    // degradation preserved from before the fix).
    expect(
      screen.getByRole("button", { name: "Copy akb URI" }),
    ).toBeInTheDocument();
  });
});
