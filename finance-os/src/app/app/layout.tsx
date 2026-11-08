import type { Metadata } from "next";
import { FinanceProvider } from "@/store/FinanceProvider";
import { Gate } from "@/components/Gate";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "CFoh! · your dashboard",
  robots: { index: false, follow: false },
};

/** The application itself lives under /app; the marketing homepage is the parent route. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FinanceProvider>
      <Gate>{children}</Gate>
      <PwaRegister />
    </FinanceProvider>
  );
}
