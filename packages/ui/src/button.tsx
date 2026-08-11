import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils";
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(({ className, type = "button", ...props }, ref) => <button ref={ref} type={type} className={cn("trace-button", className)} {...props} />);
Button.displayName = "Button";
