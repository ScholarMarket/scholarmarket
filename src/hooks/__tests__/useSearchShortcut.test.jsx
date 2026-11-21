import React, { useRef } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import useSearchShortcut from "../useSearchShortcut";
function Search() {
  const ref = useRef(null);
  useSearchShortcut(ref);
  return <><input aria-label="Search" ref={ref} /><input aria-label="Other" /><textarea aria-label="Notes" /><div contentEditable suppressContentEditableWarning data-testid="editor"><span>Editable child</span></div></>;
}
describe("marketplace search shortcut", () => {
  it("focuses search and prevents inserting a slash", () => {
    render(<Search />);
    expect(fireEvent.keyDown(window, { key: "/" })).toBe(false);
    expect(screen.getByLabelText("Search")).toHaveFocus();
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });
  it.each(["Search", "Other", "Notes"])("ignores typing in %s", label => {
    render(<Search />);
    const field = screen.getByLabelText(label);
    field.focus();
    expect(fireEvent.keyDown(field, { key: "/" })).toBe(true);
    expect(field).toHaveFocus();
  });
  it("ignores nested contenteditable targets and modified shortcuts", () => {
    render(<Search />);
    expect(fireEvent.keyDown(screen.getByText("Editable child"), { key: "/" })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "/", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "/", altKey: true })).toBe(true);
    expect(screen.getByLabelText("Search")).not.toHaveFocus();
  });
  it("removes the global listener on unmount", () => {
    const { unmount } = render(<Search />);
    unmount();
    expect(fireEvent.keyDown(window, { key: "/" })).toBe(true);
  });
});
