import type { TableHTMLAttributes } from "react";
import { cn } from "./utils";
export function Table({ className, "aria-label": ariaLabel = "Data table", ...props }: TableHTMLAttributes<HTMLTableElement>) { return <div className="trace-table-wrap"><table aria-label={ariaLabel} className={cn("trace-table", className)} {...props} /></div>; }
