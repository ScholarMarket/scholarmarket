import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, it, expect, vi } from "vitest";
import Pagination from "../Pagination";

expect.extend(toHaveNoViolations);

describe("Pagination", () => {
  it("renders nothing when there is a single page", () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onPageChange={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when totalPages is missing", () => {
    const { container } = render(<Pagination page={1} onPageChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a pagination landmark with Previous/Next and page buttons", () => {
    render(<Pagination page={3} totalPages={5} onPageChange={vi.fn()} />);
    expect(
      screen.getByRole("navigation", { name: "Pagination" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 3" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("marks only the active page with aria-current", () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(
      screen.getByRole("button", { name: "Page 1" })
    ).not.toHaveAttribute("aria-current");
  });

  it("calls onPageChange with the clicked page number", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Page 4" }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("Previous and Next step within bounds", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenLastCalledWith(4);
  });

  it("disables Previous on the first page and Next on the last page", () => {
    const { rerender } = render(
      <Pagination page={1} totalPages={5} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();

    rerender(<Pagination page={5} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("does not call onPageChange from a disabled boundary button", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={5} onPageChange={onPageChange} />);
    const previous = screen.getByRole("button", { name: "Previous" });
    expect(previous).toBeDisabled();
    await userEvent.click(previous);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("renders an ellipsis for large page ranges", () => {
    render(<Pagination page={5} totalPages={10} onPageChange={vi.fn()} />);
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
  });

  it("renders the page-size selector only when onPageSizeChange is provided", () => {
    const { rerender } = render(
      <Pagination page={1} totalPages={5} onPageChange={vi.fn()} />
    );
    expect(
      screen.queryByRole("combobox", { name: "Items per page" })
    ).toBeNull();

    rerender(
      <Pagination
        page={1}
        totalPages={5}
        onPageChange={vi.fn()}
        pageSize={12}
        onPageSizeChange={vi.fn()}
      />
    );
    expect(
      screen.getByRole("combobox", { name: "Items per page" })
    ).toBeInTheDocument();
  });

  it("reports the selected page size when the selector changes", async () => {
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        page={1}
        totalPages={5}
        onPageChange={vi.fn()}
        pageSize={12}
        onPageSizeChange={onPageSizeChange}
        pageSizeOptions={[12, 24, 48]}
      />
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Items per page" }),
      "24"
    );
    expect(onPageSizeChange).toHaveBeenCalledWith(24);
  });

  it("activates a page button with the Enter key", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />);
    const page4 = screen.getByRole("button", { name: "Page 4" });
    page4.focus();
    await userEvent.keyboard("{Enter}");
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("activates the Next button with the Space key", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />);
    const next = screen.getByRole("button", { name: "Next" });
    next.focus();
    await userEvent.keyboard(" ");
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("moves focus through controls with Tab", async () => {
    render(<Pagination page={3} totalPages={5} onPageChange={vi.fn()} />);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Previous" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveFocus();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Pagination page={3} totalPages={5} onPageChange={vi.fn()} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations with the page-size selector", async () => {
    const { container } = render(
      <Pagination
        page={3}
        totalPages={5}
        onPageChange={vi.fn()}
        pageSize={12}
        onPageSizeChange={vi.fn()}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
