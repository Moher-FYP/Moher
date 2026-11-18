import { Shell } from "@/components/Shell";

export default function PortalLayout({ children }: LayoutProps<"/">) {
  return <Shell>{children}</Shell>;
}
