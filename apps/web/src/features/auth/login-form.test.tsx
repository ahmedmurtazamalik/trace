import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/api/auth";
import { LoginForm } from "./login-form";
const session = {
  user: { id: "usr_1", username: "alice.dev", displayName: "Alice", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf_value",
};

describe("LoginForm", () => {
  it("validates required fields before making a request", async () => {
    const authenticate = vi.fn();
    render(<LoginForm onAuthenticated={vi.fn()} authenticate={authenticate} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your username.")).toBeVisible();
    expect(screen.getByText("Enter your password.")).toBeVisible();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("submits once, exposes progress, and returns the validated session", async () => {
    let resolveLogin!: (value: typeof session) => void;
    const authenticate = vi.fn().mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
    const onAuthenticated = vi.fn();
    render(<LoginForm onAuthenticated={onAuthenticated} authenticate={authenticate} />);
    await userEvent.type(screen.getByLabelText("Username"), "alice.dev");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery-staple");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(authenticate).toHaveBeenCalledTimes(1);
    resolveLogin(session);
    expect(await screen.findByText("Signed in securely." )).toBeVisible();
    expect(onAuthenticated).toHaveBeenCalledWith(session);
  });

  it.each([
    ["INVALID_CREDENTIALS", "The username or password is incorrect."],
    ["ACCOUNT_DISABLED", "This account is disabled. Contact support for help."],
    ["RATE_LIMITED", "Too many attempts. Please wait and try again."],
  ] as const)("renders the safe %s state", async (code, message) => {
    const authenticate = vi.fn().mockImplementation(async () => {
      throw new AuthApiError(code, message, code === "RATE_LIMITED" ? 429 : 401);
    });
    render(<LoginForm onAuthenticated={vi.fn()} authenticate={authenticate} />);
    await userEvent.type(screen.getByLabelText("Username"), "alice.dev");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});
