import type { HTMLAttributes } from "react";
import { cn } from "./utils";
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) { return <span className={cn("trace-badge", className)} {...props} />; }
