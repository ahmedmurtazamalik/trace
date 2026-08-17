import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/api/auth";
import { ForgotPasswordForm } from "./forgot-password-form";
import { RegisterForm } from "./register-form";
import { ResetPasswordForm } from "./reset-password-form";

const session = {
  user: { id: "usr_1", username: "alice.dev", displayName: "Alice", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf_value",
};

describe("RegisterForm", () => {
  it("enforces the frozen username, email, and password constraints before submission", async () => {
    const createAccount = vi.fn();
    render(<RegisterForm createAccount={createAccount} onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Username"), "a!");
    await userEvent.type(screen.getByLabelText("Email (optional)"), "not-email");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Use 3–39 letters, numbers, dots, underscores, or hyphens.")).toBeVisible();
    expect(screen.getByText("Enter a valid email address.")).toBeVisible();
    expect(screen.getByText("Use at least 12 characters.")).toBeVisible();
    expect(screen.getByLabelText("Username")).toHaveFocus();
    expect(createAccount).not.toHaveBeenCalled();
  });

  it("submits normalized optional values and establishes the session", async () => {
    const createAccount = vi.fn().mockResolvedValue(session);
    const onAuthenticated = vi.fn();
    render(<RegisterForm createAccount={createAccount} onAuthenticated={onAuthenticated} />);
    await userEvent.type(screen.getByLabelText("Username"), "alice.dev");
    await userEvent.type(screen.getByLabelText("Display name (optional)"), " Alice ");
    await userEvent.type(screen.getByLabelText("Email (optional)"), "alice@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery-staple");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Account created securely.");
    expect(createAccount).toHaveBeenCalledWith({ username: "alice.dev", displayName: "Alice", email: "alice@example.com", password: "correct-horse-battery-staple" });
    expect(onAuthenticated).toHaveBeenCalledWith(session);
  });

  it("renders username conflicts safely", async () => {
    const createAccount = vi.fn().mockRejectedValue(new AuthApiError("USERNAME_TAKEN", "That username is already in use.", 409));
    render(<RegisterForm createAccount={createAccount} onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Username"), "alice.dev");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery-staple");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That username is already in use.");
  });
});

describe("ForgotPasswordForm", () => {
  it("always renders the same non-enumerating success message", async () => {
    const requestReset = vi.fn().mockResolvedValue({ message: "If the account exists, password reset instructions have been sent." });
    render(<ForgotPasswordForm requestReset={requestReset} />);
    await userEvent.type(screen.getByLabelText("Username or email"), "unknown@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Request reset" }));
    expect(await screen.findByRole("status")).toHaveTextContent("If the account exists, password reset instructions have been sent.");
  });
});

describe("ResetPasswordForm", () => {
  it("blocks submission when the URL has no reset token", () => {
    render(<ResetPasswordForm token={null} resetCredential={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This reset link is invalid or has expired.");
    expect(screen.getByRole("button", { name: "Update password" })).toBeDisabled();
  });

  it("submits a valid token and new password", async () => {
    const resetCredential = vi.fn().mockResolvedValue({ success: true });
    render(<ResetPasswordForm token="opaque-token" resetCredential={resetCredential} />);
    await userEvent.type(screen.getByLabelText("New password"), "correct-horse-battery-staple");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Password updated. You can now sign in.");
    expect(resetCredential).toHaveBeenCalledWith({ token: "opaque-token", password: "correct-horse-battery-staple" });
  });
});
