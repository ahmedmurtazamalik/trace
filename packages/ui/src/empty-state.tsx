interface EmptyStateProps { title: string; description: string; }
export function EmptyState({ title, description }: EmptyStateProps) { return <section className="trace-state" role="status"><strong>{title}</strong><p>{description}</p></section>; }
