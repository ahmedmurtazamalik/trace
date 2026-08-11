import type { HTMLAttributes } from "react";
import { cn } from "./utils";
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn("trace-skeleton", className)} {...props} />; }
