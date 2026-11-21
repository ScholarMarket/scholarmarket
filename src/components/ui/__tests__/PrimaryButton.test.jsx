import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, it, expect, vi } from "vitest";
import { FaSpinner } from "react-icons/fa";
import PrimaryButton from "../PrimaryButton";

expect.extend(toHaveNoViolations);

describe("PrimaryButton", () => {
  it("renders a button with its children", () => {
    render(<PrimaryButton>Save</PrimaryButton>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("spreads button props such as type and aria-label", () => {
    render(
      <PrimaryButton type="submit" aria-label="Save changes">
        Save
      </PrimaryButton>
    );
    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button).toHaveAttribute("type", "submit");
  });

  it("applies the primary variant classes by default", () => {
    render(<PrimaryButton>Save</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveClass("bg-slate-950");
  });

  it.each([
    ["primary", "bg-slate-950"],
    ["secondary", "bg-white"],
    ["accent", "bg-blue-600"],
    ["success", "bg-emerald-600"],
  ])("applies the %s variant classes", (variant, expectedClass) => {
    render(<PrimaryButton variant={variant}>Save</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveClass(expectedClass);
  });

  it("falls back to the primary variant for an unknown variant", () => {
    render(<PrimaryButton variant="mystery">Save</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveClass("bg-slate-950");
  });

  it("merges a custom className", () => {
    render(<PrimaryButton className="my-custom-class">Save</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveClass("my-custom-class");
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<PrimaryButton onClick={onClick}>Save</PrimaryButton>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled and does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <PrimaryButton disabled onClick={onClick}>
        Save
      </PrimaryButton>
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a disabled loading state with spinner content", async () => {
    const { container } = render(
      <PrimaryButton disabled aria-label="Saving">
        <FaSpinner data-testid="spinner" />
        Saving…
      </PrimaryButton>
    );
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations across variants and the disabled state", async () => {
    const { container } = render(
      <div>
        <PrimaryButton variant="primary">Primary</PrimaryButton>
        <PrimaryButton variant="secondary">Secondary</PrimaryButton>
        <PrimaryButton variant="accent">Accent</PrimaryButton>
        <PrimaryButton variant="success">Success</PrimaryButton>
        <PrimaryButton disabled>Disabled</PrimaryButton>
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
