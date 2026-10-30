export function FeaturePage({ title, description, pending = true }: { title: string; description: string; pending?: boolean }) {
  return <section className="panel"><p className="eyebrow">SONORA WEB</p><h1>{title}</h1><p>{description}</p>{pending && <p className="status" role="status">Coming soon — this feature is not connected yet.</p>}</section>;
}
