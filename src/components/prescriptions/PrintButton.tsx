"use client";
import Button from "@/components/ui/Button";
export default function PrintButton({ label = "Print prescription" }: { label?: string }) {
  return <Button onClick={() => window.print()}>{label}</Button>;
}
