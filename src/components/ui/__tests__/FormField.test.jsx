import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, it, expect, vi } from "vitest";
import FormField from "../../FormField";

expect.extend(toHaveNoViolations);

describe("FormField", () => {
  it("renders a label associated with the input via htmlFor/id", () => {
    render(<FormField label="Email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
  });

  it("honours the type prop", () => {
    render(<FormField label="Email" type="email" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("marks the input invalid and associates the error message", () => {
    render(<FormField label="Email" error="Email is required" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Email is required");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("shows and associates help text when there is no error", () => {
    render(<FormField label="Email" helpText="We never share your email." />);
    const input = screen.getByLabelText("Email");
    const help = screen.getByText("We never share your email.");
    expect(input.getAttribute("aria-describedby")).toContain(help.id);
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  it("hides help text when an error is present", () => {
    render(
      <FormField label="Email" helpText="We never share your email." error="Invalid email" />
    );
    const input = screen.getByLabelText("Email");
    const alert = screen.getByRole("alert");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(screen.queryByText("We never share your email.")).toBeNull();
  });

  it("forwards the disabled state", () => {
    render(<FormField label="Email" disabled />);
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("forwards user typing", async () => {
    render(<FormField label="Email" />);
    const input = screen.getByLabelText("Email");
    await userEvent.type(input, "hello@example.com");
    expect(input).toHaveValue("hello@example.com");
  });

  it("has no accessibility violations with help text", async () => {
    const { container } = render(
      <FormField label="Email" helpText="We never share your email." />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations with an error", async () => {
    const { container } = render(<FormField label="Email" error="Email is required" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
