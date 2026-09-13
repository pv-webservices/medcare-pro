import PortalHistoryPage from "@/components/patientPortal/PortalHistoryPage";
export default function Page(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PortalHistoryPage kind="prescriptions" {...props} />;
}
