import ConsultationWorkspace from "@/components/prescriptions/ConsultationWorkspace";
import { getConsultationForRegistration } from "@/lib/prescriptions";
import { prescriptionPage } from "@/lib/prescriptionPages";
import { mayUseWritingAssistant } from "@/lib/clinical-ai/writingAssistant";
import {
  mayUseClinicalAudio,
  mayViewClinicalAudio,
} from "@/lib/clinical-audio/authorization";
import { getClinicalAudioConfig } from "@/lib/clinical-audio/config";
import { mayUseReconciliation } from "@/lib/clinical-reconciliation/service";
import { prescriptionChecksEnabled } from "@/lib/prescription-checks/config";
export const dynamic = "force-dynamic";
export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, mayUseAi, clinicalAudio, reconciliation, finalizedAudio } =
    await prescriptionPage(async (actor) => {
      const data = await getConsultationForRegistration(actor, id);
      const finalized = !!data.prescription && data.prescription.status !== "DRAFT";
      return {
        data,
        mayUseAi: await mayUseWritingAssistant(actor, id),
        clinicalAudio: (await mayUseClinicalAudio(actor, id))
          ? { maxMinutes: getClinicalAudioConfig()!.maxMinutes }
          : null,
        reconciliation: await mayUseReconciliation(actor, id),
        finalizedAudio: finalized && (await mayViewClinicalAudio(actor, id)),
      };
    });
  return (
    <ConsultationWorkspace
      key={data.prescription?.id ?? id}
      data={data}
      mayUseAi={mayUseAi}
      clinicalAudio={clinicalAudio}
      reconciliation={reconciliation}
      finalizedAudio={finalizedAudio}
      preIssueChecks={prescriptionChecksEnabled()}
    />
  );
}
