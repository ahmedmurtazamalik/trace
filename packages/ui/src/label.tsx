import type { LabelHTMLAttributes } from "react";
import { cn } from "./utils";
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) { return <label className={cn("trace-label", className)} {...props} />; }
