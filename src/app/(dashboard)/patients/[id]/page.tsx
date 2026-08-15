// Single patient record + appointment history — PRD §6.2 (FR-2.3, FR-2.4).
// Stage 1. SCAFFOLD ONLY.

interface PatientDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PatientDetailPage({ params }: PatientDetailPageProps) {
  const { id } = await params;

  return (
    <section>
      <h1>Patient {id}</h1>
      <p>Not implemented yet.</p>
    </section>
  );
}
