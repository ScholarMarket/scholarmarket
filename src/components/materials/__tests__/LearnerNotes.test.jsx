import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  useMaterialNote: vi.fn(),
  useSaveMaterialNote: vi.fn(),
}));

vi.mock("@/hooks/api/useMaterials", () => ({
  useMaterialNote: mocks.useMaterialNote,
  useSaveMaterialNote: mocks.useSaveMaterialNote,
}));

import LearnerNotes, { renderSanitizedMarkdown } from "../LearnerNotes";

let mutate;

beforeEach(() => {
  vi.clearAllMocks();
  mutate = vi.fn((value, options) => options?.onSuccess?.());
  mocks.useMaterialNote.mockReturnValue({
    isLoading: false,
    isSuccess: true,
    data: { note: "Existing note", updatedAt: "2026-01-01T00:00:00Z" },
    error: null,
  });
  mocks.useSaveMaterialNote.mockReturnValue({ mutate, isPending: false, error: null });
});

describe("LearnerNotes", () => {
  it("loads and displays a saved note with 'Saved' status", () => {
    render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
    expect(screen.getByLabelText("Personal notes for this resource")).toHaveValue("Existing note");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows a loading placeholder while the note is being fetched", () => {
    mocks.useMaterialNote.mockReturnValue({ isLoading: true, data: undefined, error: null });
    render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
    expect(screen.getByLabelText("Your notes")).toHaveClass("animate-pulse");
  });

  it("edits and manually saves an updated note", () => {
    render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
    const textarea = screen.getByLabelText("Personal notes for this resource");
    fireEvent.change(textarea, { target: { value: "A revised takeaway" } });

    const saveButton = screen.getByRole("button", { name: /save notes/i });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(mutate).toHaveBeenCalledWith(
      "A revised takeaway",
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("displays a save error when persistence fails", () => {
    mocks.useSaveMaterialNote.mockReturnValue({
      mutate,
      isPending: false,
      error: { message: "Could not save note" },
    });
    render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
    expect(screen.getByText("Could not save note")).toBeInTheDocument();
  });

  it("treats a 404 as an empty note rather than an error", () => {
    mocks.useMaterialNote.mockReturnValue({
      isLoading: false,
      isSuccess: false,
      data: undefined,
      error: { status: 404 },
    });
    render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
    expect(screen.getByLabelText("Personal notes for this resource")).toHaveValue("");
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });

  describe("Debounced autosave", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("autosaves 1s after typing stops and shows 'Saving… / Saved' status", () => {
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
      const textarea = screen.getByLabelText("Personal notes for this resource");

      // User types changes
      act(() => {
        fireEvent.change(textarea, { target: { value: "Autosaved note content" } });
      });

      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      expect(mutate).not.toHaveBeenCalled();

      // Advance by 500ms — should NOT save yet
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(mutate).not.toHaveBeenCalled();

      // Advance another 500ms (1000ms total) — autosave triggers
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(mutate).toHaveBeenCalledWith(
        "Autosaved note content",
        expect.objectContaining({ onSuccess: expect.any(Function) })
      );
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("resets 1s debounce timer if user types again before 1s", () => {
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
      const textarea = screen.getByLabelText("Personal notes for this resource");

      act(() => {
        fireEvent.change(textarea, { target: { value: "First draft" } });
      });

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(mutate).not.toHaveBeenCalled();

      // User types again before 1s
      act(() => {
        fireEvent.change(textarea, { target: { value: "Second draft" } });
      });

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(mutate).not.toHaveBeenCalled();

      // Complete the remaining 400ms for second change
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledWith(
        "Second draft",
        expect.objectContaining({ onSuccess: expect.any(Function) })
      );
    });

    it("shows 'Saving…' status while save is in flight", () => {
      mocks.useSaveMaterialNote.mockReturnValue({ mutate, isPending: true, error: null });
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
      const savingElements = screen.getAllByText("Saving…");
      expect(savingElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("beforeunload warning", () => {
    it("warns on beforeunload if a save is pending (unsaved edits)", () => {
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);
      const textarea = screen.getByLabelText("Personal notes for this resource");

      // Type some unsaved changes
      fireEvent.change(textarea, { target: { value: "Pending change" } });

      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it("warns on beforeunload if a save mutation is in-flight", () => {
      mocks.useSaveMaterialNote.mockReturnValue({ mutate, isPending: true, error: null });
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);

      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it("does not warn on beforeunload if no save is pending", () => {
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);

      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("Write / Preview tabs and Markdown rendering", () => {
    it("switches between Write and Preview tabs", () => {
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);

      const writeTab = screen.getByRole("tab", { name: /^write$/i });
      const previewTab = screen.getByRole("tab", { name: /^preview$/i });

      expect(writeTab).toHaveAttribute("aria-selected", "true");
      expect(previewTab).toHaveAttribute("aria-selected", "false");
      expect(screen.getByLabelText("Personal notes for this resource")).toBeInTheDocument();

      // Switch to preview
      fireEvent.click(previewTab);

      expect(previewTab).toHaveAttribute("aria-selected", "true");
      expect(writeTab).toHaveAttribute("aria-selected", "false");
      expect(screen.getByLabelText("Notes preview")).toBeInTheDocument();
      expect(screen.queryByLabelText("Personal notes for this resource")).not.toBeInTheDocument();

      // Switch back to write
      fireEvent.click(writeTab);
      expect(screen.getByLabelText("Personal notes for this resource")).toBeInTheDocument();
    });

    it("shows 'Nothing to preview' when note is empty in Preview tab", () => {
      mocks.useMaterialNote.mockReturnValue({
        isLoading: false,
        isSuccess: true,
        data: { note: "" },
        error: null,
      });
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);

      fireEvent.click(screen.getByRole("tab", { name: /^preview$/i }));
      expect(screen.getByText("Nothing to preview.")).toBeInTheDocument();
    });

    it("renders formatted markdown in the preview", () => {
      mocks.useMaterialNote.mockReturnValue({
        isLoading: false,
        isSuccess: true,
        data: {
          note: "# Heading 1\n**Bold note**\n- Bullet item\n[Documentation](https://stellar.org)",
        },
        error: null,
      });
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);

      fireEvent.click(screen.getByRole("tab", { name: /^preview$/i }));
      const preview = screen.getByLabelText("Notes preview");

      expect(preview.querySelector("h1")).toHaveTextContent("Heading 1");
      expect(preview.querySelector("strong")).toHaveTextContent("Bold note");
      expect(preview.querySelector("li")).toHaveTextContent("Bullet item");
      const link = preview.querySelector("a");
      expect(link).toHaveAttribute("href", "https://stellar.org");
      expect(link).toHaveTextContent("Documentation");
    });

    it("strips scripts and unsafe HTML from preview", () => {
      mocks.useMaterialNote.mockReturnValue({
        isLoading: false,
        isSuccess: true,
        data: {
          note: "# Safe Title\n<script>alert('xss')</script>\n<img src=x onerror=\"alert(1)\" />\n<iframe src=\"https://malicious.com\"></iframe>\n[Evil](javascript:alert(1))",
        },
        error: null,
      });
      render(<LearnerNotes materialId="mat-1" walletAddress="GCUSTOMER" />);

      fireEvent.click(screen.getByRole("tab", { name: /^preview$/i }));
      const preview = screen.getByLabelText("Notes preview");

      expect(preview.querySelector("h1")).toHaveTextContent("Safe Title");
      expect(preview.querySelector("script")).toBeNull();
      expect(preview.innerHTML).not.toContain("alert('xss')");
      expect(preview.querySelector("iframe")).toBeNull();
      expect(preview.innerHTML).not.toContain("onerror");
      expect(preview.innerHTML).not.toContain("javascript:");
    });
  });

  describe("renderSanitizedMarkdown helper unit tests", () => {
    it("handles empty or non-string input safely", () => {
      expect(renderSanitizedMarkdown("")).toBe("");
      expect(renderSanitizedMarkdown(null)).toBe("");
      expect(renderSanitizedMarkdown(undefined)).toBe("");
    });

    it("strips script tags and their contents", () => {
      const output = renderSanitizedMarkdown("<script type='text/javascript'>maliciousCode();</script>Safe text");
      expect(output).not.toContain("script");
      expect(output).not.toContain("maliciousCode");
      expect(output).toContain("Safe text");
    });

    it("strips event handlers such as onerror and onclick", () => {
      const output = renderSanitizedMarkdown('<img src="test.jpg" onerror="alert(1)" onclick="hack()" />');
      expect(output).not.toContain("onerror");
      expect(output).not.toContain("onclick");
      expect(output).toContain('src="test.jpg"');
    });

    it("neutralizes javascript: in links", () => {
      const output = renderSanitizedMarkdown("[Click me](javascript:alert('xss'))");
      expect(output).not.toContain("javascript:");
    });

    it("safely escapes code blocks containing html/script tags", () => {
      const output = renderSanitizedMarkdown("```html\n<script>console.log('hi')</script>\n```");
      expect(output).toContain("&lt;script&gt;");
      expect(output).toContain("<pre");
      expect(output).not.toMatch(/<script\b/i);
    });
  });
});
