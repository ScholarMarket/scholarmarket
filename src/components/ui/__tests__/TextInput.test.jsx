import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, it, expect, vi } from "vitest";
import TextInput from "../TextInput";

expect.extend(toHaveNoViolations);

describe("TextInput", () => {
  it("renders a bare input when no label is provided", () => {
    const { container } = render(<TextInput placeholder="Email" />);
    expect(container.querySelector("label")).toBeNull();
    expect(container.querySelector("input")).toBeInTheDocument();
  });

  it("renders a label associated with the input", () => {
    render(<TextInput label="Email address" />);
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  });

  it("marks the input invalid and associates the error message", () => {
    render(<TextInput label="Email" error="Email is required" />);
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Email is required");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("shows help text and associates it with the input when there is no error", () => {
    render(<TextInput label="Email" helpText="We never share your email." />);
    const input = screen.getByLabelText(/Email/);
    const help = screen.getByText("We never share your email.");
    expect(input.getAttribute("aria-describedby")).toContain(help.id);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("hides help text when an error is present and only describes via the error", () => {
    render(
      <TextInput
        label="Email"
        helpText="We never share your email."
        error="Invalid email"
      />
    );
    const input = screen.getByLabelText(/Email/);
    const alert = screen.getByRole("alert");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(screen.queryByText("We never share your email.")).toBeNull();
  });

  it("forwards the disabled state to the input", () => {
    render(<TextInput label="Email" disabled />);
    expect(screen.getByLabelText(/Email/)).toBeDisabled();
  });

  it("forwards user typing to the input", async () => {
    render(<TextInput label="Email" />);
    const input = screen.getByLabelText(/Email/);
    await userEvent.type(input, "hello@example.com");
    expect(input).toHaveValue("hello@example.com");
  });

  it("has no accessibility violations with help text", async () => {
    const { container } = render(
      <TextInput label="Email" helpText="We never share your email." />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations with an error", async () => {
    const { container } = render(<TextInput label="Email" error="Email is required" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations without a label", async () => {
    const { container } = render(<TextInput aria-label="Search" placeholder="Search" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
