import { render, screen, fireEvent } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Web3ErrorBoundary from "../Web3ErrorBoundary";
import Web3TransactionFallback, { deriveWeb3Guidance } from "../Web3TransactionFallback";

expect.extend(toHaveNoViolations);

// ── Sentry mock ───────────────────────────────────────────────────────────────
// The alias @sentry/nextjs is mapped to test/mocks/sentry-nextjs.js in
// vitest.config.mjs.  We spy on captureException to assert that the boundary
// reports errors to Sentry.
vi.mock("@sentry/nextjs", async () => {
  const actual = await vi.importActual("@sentry/nextjs");
  return { ...actual, captureException: vi.fn() };
});

import * as Sentry from "@sentry/nextjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A child that throws synchronously when `shouldThrow` is true. */
function ThrowingChild({ shouldThrow = false, message = "boom" }) {
  if (shouldThrow) throw new Error(message);
  return <p data-testid="child-ok">Children rendered</p>;
}

/** Suppress the React error-boundary console.error noise in test output. */
function suppressBoundaryConsole() {
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });
}

// ── Web3ErrorBoundary ─────────────────────────────────────────────────────────

describe("Web3ErrorBoundary", () => {
  suppressBoundaryConsole();

  describe("normal (no error) path", () => {
    it("renders children when no error is thrown", () => {
      render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow={false} />
        </Web3ErrorBoundary>
      );
      expect(screen.getByTestId("child-ok")).toBeInTheDocument();
    });

    it("does not render the fallback when children are healthy", () => {
      render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow={false} />
        </Web3ErrorBoundary>
      );
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("error capture", () => {
    it("renders the Web3TransactionFallback when a child throws", () => {
      render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow message="Transaction rejected by wallet" />
        </Web3ErrorBoundary>
      );
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("displays the error message in the fallback", () => {
      render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow message="Transaction rejected by wallet" />
        </Web3ErrorBoundary>
      );
      expect(
        screen.getByText(/Transaction rejected by wallet/i)
      ).toBeInTheDocument();
    });

    it("does not render children after an error", () => {
      render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow message="boom" />
        </Web3ErrorBoundary>
      );
      expect(screen.queryByTestId("child-ok")).toBeNull();
    });

    it("calls Sentry.captureException with the thrown error", () => {
      const thrownError = new Error("insufficient xlm for fees");
      function Bomb() {
        throw thrownError;
      }
      render(
        <Web3ErrorBoundary>
          <Bomb />
        </Web3ErrorBoundary>
      );
      expect(Sentry.captureException).toHaveBeenCalledWith(
        thrownError,
        expect.objectContaining({ extra: expect.any(Object) })
      );
    });

    it("calls Sentry.captureException exactly once per error", () => {
      Sentry.captureException.mockClear();
      function Bomb() {
        throw new Error("oops");
      }
      render(
        <Web3ErrorBoundary>
          <Bomb />
        </Web3ErrorBoundary>
      );
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
  });

  describe("reset / retry", () => {
    it("re-renders children after the retry button is clicked", () => {
      const { rerender } = render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow message="boom" />
        </Web3ErrorBoundary>
      );

      // Fallback is showing.
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // Click Retry — the boundary resets its state.
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));

      // Re-render with a healthy child so the boundary can show it.
      rerender(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow={false} />
        </Web3ErrorBoundary>
      );

      expect(screen.getByTestId("child-ok")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("calls the onRetry prop callback when Retry is clicked", () => {
      const onRetry = vi.fn();
      render(
        <Web3ErrorBoundary onRetry={onRetry}>
          <ThrowingChild shouldThrow message="boom" />
        </Web3ErrorBoundary>
      );
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("does not throw when onRetry prop is not provided", () => {
      render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow message="boom" />
        </Web3ErrorBoundary>
      );
      expect(() =>
        fireEvent.click(screen.getByRole("button", { name: /retry/i }))
      ).not.toThrow();
    });

    it("shows the fallback again if the retried child throws again", () => {
      const { rerender } = render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow message="first boom" />
        </Web3ErrorBoundary>
      );

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));

      // Child throws again on re-render.
      rerender(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow message="second boom" />
        </Web3ErrorBoundary>
      );

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/second boom/i)).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("fallback has no accessibility violations", async () => {
      const { container } = render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow message="Transaction rejected" />
        </Web3ErrorBoundary>
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it("healthy children have no accessibility violations", async () => {
      const { container } = render(
        <Web3ErrorBoundary>
          <ThrowingChild shouldThrow={false} />
        </Web3ErrorBoundary>
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

// ── Web3TransactionFallback ───────────────────────────────────────────────────

describe("Web3TransactionFallback", () => {
  describe("fallback copy for common wallet errors", () => {
    it("shows the insufficient-XLM guidance for a balance error", () => {
      render(
        <Web3TransactionFallback error={new Error("insufficient xlm for fees")} />
      );
      expect(screen.getByText(/Insufficient XLM for network fees/i)).toBeInTheDocument();
      expect(screen.getByText(/Add a small amount of XLM/i)).toBeInTheDocument();
    });

    it("shows the insufficient-XLM guidance for an 'underfunded' message", () => {
      render(
        <Web3TransactionFallback error={new Error("account underfunded")} />
      );
      expect(screen.getByText(/Insufficient XLM for network fees/i)).toBeInTheDocument();
    });

    it("shows the network/RPC guidance for a timeout error", () => {
      render(
        <Web3TransactionFallback error={new Error("RPC timeout: 503")} />
      );
      expect(
        screen.getByText(/Network or RPC service unavailable/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
    });

    it("shows the network/RPC guidance for a 'failed to fetch' error", () => {
      render(
        <Web3TransactionFallback error={new Error("Failed to fetch")} />
      );
      expect(
        screen.getByText(/Network or RPC service unavailable/i)
      ).toBeInTheDocument();
    });

    it("shows the rejection guidance for a cancelled-wallet error", () => {
      render(
        <Web3TransactionFallback error={new Error("Transaction rejected by user")} />
      );
      expect(screen.getByText(/Transaction was rejected/i)).toBeInTheDocument();
      expect(screen.getByText(/cancelled in your wallet/i)).toBeInTheDocument();
    });

    it("shows the rejection guidance for a 'declined' error", () => {
      render(
        <Web3TransactionFallback error={new Error("Payment declined")} />
      );
      expect(screen.getByText(/Transaction was rejected/i)).toBeInTheDocument();
    });

    it("shows the generic guidance for an unrecognised error", () => {
      render(
        <Web3TransactionFallback error={new Error("some completely unknown error xyz")} />
      );
      expect(
        screen.getByText(/Blockchain transaction failed/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/verify your wallet connection/i)).toBeInTheDocument();
    });

    it("shows 'Unknown blockchain error' when error has no message", () => {
      render(<Web3TransactionFallback error={{}} />);
      expect(screen.getByText(/Unknown blockchain error/i)).toBeInTheDocument();
    });

    it("renders gracefully when error is null", () => {
      render(<Web3TransactionFallback error={null} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/Unknown blockchain error/i)).toBeInTheDocument();
    });

    it("displays the technical error details in the fallback", () => {
      render(
        <Web3TransactionFallback
          error={new Error("op_no_trust: missing trustline")}
        />
      );
      expect(
        screen.getByText(/op_no_trust: missing trustline/i)
      ).toBeInTheDocument();
    });
  });

  describe("Retry button", () => {
    it("renders a Retry button when onRetry is provided", () => {
      render(
        <Web3TransactionFallback
          error={new Error("boom")}
          onRetry={vi.fn()}
        />
      );
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("does not render a Retry button when onRetry is absent", () => {
      render(<Web3TransactionFallback error={new Error("boom")} />);
      expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    });

    it("calls onRetry when the Retry button is clicked", () => {
      const onRetry = vi.fn();
      render(
        <Web3TransactionFallback error={new Error("boom")} onRetry={onRetry} />
      );
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("compact prop", () => {
    it("renders without the mt-4 margin class when compact is true", () => {
      const { container } = render(
        <Web3TransactionFallback error={new Error("boom")} compact />
      );
      // The root div should not add top-margin when compact.
      const root = container.firstChild;
      expect(root.className).not.toMatch(/mt-4/);
    });
  });

  describe("accessibility", () => {
    it("has no accessibility violations for each guidance branch", async () => {
      const errors = [
        new Error("insufficient xlm for fees"),
        new Error("RPC timeout"),
        new Error("Transaction rejected"),
        new Error("some unknown error"),
      ];
      for (const error of errors) {
        const { container, unmount } = render(
          <Web3TransactionFallback error={error} onRetry={vi.fn()} />
        );
        expect(await axe(container)).toHaveNoViolations();
        unmount();
      }
    });
  });
});

// ── deriveWeb3Guidance unit tests ─────────────────────────────────────────────

describe("deriveWeb3Guidance", () => {
  it.each([
    ["insufficient xlm for fees", "Insufficient XLM for network fees"],
    ["account underfunded",        "Insufficient XLM for network fees"],
    ["RPC timeout 503",            "Network or RPC service unavailable"],
    ["Failed to fetch",            "Network or RPC service unavailable"],
    ["gateway error",              "Network or RPC service unavailable"],
    ["Transaction rejected",       "Transaction was rejected"],
    ["User cancelled",             "Transaction was rejected"],
    ["payment declined",           "Transaction was rejected"],
    ["completely unknown error",   "Blockchain transaction failed"],
  ])("message '%s' → title '%s'", (message, expectedTitle) => {
    const guidance = deriveWeb3Guidance(new Error(message));
    expect(guidance.title).toBe(expectedTitle);
    expect(typeof guidance.hint).toBe("string");
    expect(guidance.details).toBe(message);
  });

  it("handles a null error", () => {
    const guidance = deriveWeb3Guidance(null);
    expect(guidance.title).toBe("Blockchain transaction failed");
    expect(guidance.details).toBe("Unknown blockchain error");
  });

  it("returns the original error message in details", () => {
    const error = new Error("specific technical message");
    const guidance = deriveWeb3Guidance(error);
    expect(guidance.details).toBe("specific technical message");
  });
});
