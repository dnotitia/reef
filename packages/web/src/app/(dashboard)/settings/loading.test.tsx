import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SettingsLoading from "./loading";

describe("settings loading.tsx", () => {
  it("renders a settings content skeleton under the tabs (REEF-255)", () => {
    render(<SettingsLoading />);
    expect(screen.getByTestId("settings-skeleton")).toBeInTheDocument();
  });
});
