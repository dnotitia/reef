import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PersonAvatar, personToneFor } from "./PersonAvatar";

afterEach(() => {
  cleanup();
});

describe("PersonAvatar", () => {
  it("renders a login-derived monogram when there is no image", () => {
    render(<PersonAvatar identityKey="alice" />);
    const avatar = screen.getByRole("img", { name: "alice" });
    expect(avatar).toHaveTextContent("AL");
  });

  it("tints the monogram from the identity ramp (a fill token, not semantic)", () => {
    const { container } = render(<PersonAvatar identityKey="alice" />);
    const cls = container.firstElementChild?.getAttribute("class") ?? "";
    expect(/\bbg-av-\d\b/.test(cls)).toBe(true);
    expect(cls).toContain("text-av-fg");
  });

  it("keeps the current user teal with tone='brand'", () => {
    const { container } = render(
      <PersonAvatar identityKey="홍길동" tone="brand" />,
    );
    const cls = container.firstElementChild?.getAttribute("class") ?? "";
    expect(cls).toContain("bg-brand");
    expect(/\bbg-av-\d\b/.test(cls)).toBe(false);
    expect(screen.getByRole("img")).toHaveTextContent("홍");
  });

  it("renders the real image over the tint when avatar_url is present", () => {
    const { container } = render(
      <PersonAvatar identityKey="ada" avatarUrl="https://example.test/a.png" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://example.test/a.png");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("shows a dashed ghost (not a solid dot) when no one is assigned", () => {
    const { container } = render(<PersonAvatar identityKey={null} />);
    const avatar = screen.getByRole("img", { name: "Unassigned" });
    expect(avatar.getAttribute("class") ?? "").toContain("border-dashed");
    expect(container.querySelector("img")).toBeNull();
  });

  it("hides itself from the a11y tree when decorative", () => {
    const { container } = render(
      <PersonAvatar identityKey="alice" decorative />,
    );
    const avatar = container.firstElementChild;
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).not.toHaveAttribute("role");
  });
});

describe("personToneFor (REEF-173)", () => {
  it("gives the signed-in user the brand tone", () => {
    expect(personToneFor("alice", "alice")).toBe("brand");
  });

  it("gives everyone else the hashed identity tone", () => {
    expect(personToneFor("bob", "alice")).toBe("identity");
  });

  it("is identity when no one is signed in", () => {
    expect(personToneFor("alice", null)).toBe("identity");
    expect(personToneFor("alice", undefined)).toBe("identity");
  });

  it("is identity for an absent or empty key (never matches an empty login)", () => {
    expect(personToneFor(null, "alice")).toBe("identity");
    expect(personToneFor("", "alice")).toBe("identity");
    expect(personToneFor("", "")).toBe("identity");
  });

  it("ignores surrounding whitespace on both sides", () => {
    expect(personToneFor(" alice ", "alice")).toBe("brand");
  });
});
