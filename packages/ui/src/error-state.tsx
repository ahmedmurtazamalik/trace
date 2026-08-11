interface ErrorStateProps { title: string; description: string; }
export function ErrorState({ title, description }: ErrorStateProps) { return <section className="trace-state trace-state-error" role="alert"><strong>{title}</strong><p>{description}</p></section>; }
