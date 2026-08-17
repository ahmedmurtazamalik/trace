"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@trace/ui";

interface AccessibleConfirmDialogProps {
  title: string;
  description: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  pending?: boolean;
  returnFocus: HTMLElement | null;
  onCancel(): void;
  onConfirm(): void;
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function AccessibleConfirmDialog({
  title,
  description,
  cancelLabel = "Cancel",
  confirmLabel,
  pending = false,
  returnFocus,
  onCancel,
  onConfirm,
}: AccessibleConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    return () => returnFocus?.focus();
  }, [returnFocus]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="trace-dialog-backdrop">
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="trace-dialog github-dialog"
      onKeyDown={handleKeyDown}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={descriptionId}>{description}</div>
      <div className="github-dialog-actions">
        <Button ref={cancelRef} className="trace-button-secondary" onClick={onCancel} disabled={pending}>{cancelLabel}</Button>
        <Button className="trace-button-danger" onClick={onConfirm} disabled={pending}>{confirmLabel}</Button>
      </div>
    </section>
  </div>;
}
