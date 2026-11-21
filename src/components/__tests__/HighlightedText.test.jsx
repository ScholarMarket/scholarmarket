import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HighlightedText from "../HighlightedText";

describe("HighlightedText", () => {
  it("highlights every case-insensitive title and description match", () => {
    const { container } = render(<><h3><HighlightedText text="Calculus Notes" query="calc" /></h3><p><HighlightedText text="Practice CALC and calc" query="calc" /></p></>);
    expect([...container.querySelectorAll("mark")].map(mark => mark.textContent)).toEqual(["Calc", "CALC", "calc"]);
    expect(screen.getByRole("heading")).toHaveTextContent("Calculus Notes");
  });
  it.each(["c++", "[calc]", "a.b", "(x)", "a*b", "a?b", "$5", "a\\b"])('treats "%s" literally', term => {
    const { container } = render(<HighlightedText text={`Before ${term} after`} query={term} />);
    expect(container.querySelector("mark")).toHaveTextContent(term);
    expect(container.textContent).toBe(`Before ${term} after`);
  });
  it("renders plain text for an empty query or no match", () => {
    const { container, rerender } = render(<HighlightedText text="Calculus" query="  " />);
    expect(container.querySelector("mark")).toBeNull();
    rerender(<HighlightedText text="Calculus" query="algebra" />);
    expect(container.textContent).toBe("Calculus");
    expect(container.querySelector("mark")).toBeNull();
  });
  it("renders markup as text", () => {
    const { container } = render(<HighlightedText text="<script>alert(1)</script>" query="script" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelectorAll("mark")).toHaveLength(2);
  });
});
