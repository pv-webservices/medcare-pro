import ConsultationWorkspace from "@/components/prescriptions/ConsultationWorkspace";
import { getConsultationForRegistration } from "@/lib/prescriptions";
import { prescriptionPage } from "@/lib/prescriptionPages";
import { mayUseWritingAssistant } from "@/lib/clinical-ai/writingAssistant";
import { mayUseClinicalAudio } from "@/lib/clinical-audio/authorization";
import { getClinicalAudioConfig } from "@/lib/clinical-audio/config";
import { mayUseReconciliation } from "@/lib/clinical-reconciliation/service";
export const dynamic = "force-dynamic";
export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, mayUseAi, clinicalAudio, reconciliation } = await prescriptionPage(
    async (actor) => ({
      data: await getConsultationForRegistration(actor, id),
      mayUseAi: await mayUseWritingAssistant(actor, id),
      clinicalAudio: (await mayUseClinicalAudio(actor, id))
        ? { maxMinutes: getClinicalAudioConfig()!.maxMinutes }
        : null,
      reconciliation: await mayUseReconciliation(actor, id),
    }),
  );
  return (
    <ConsultationWorkspace
      key={data.prescription?.id ?? id}
      data={data}
      mayUseAi={mayUseAi}
      clinicalAudio={clinicalAudio}
      reconciliation={reconciliation}
    />
  );
}
