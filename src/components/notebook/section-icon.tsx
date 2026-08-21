import {
  Archive, BriefcaseBusiness, Code2, FileText, Folder, Globe2, Home, KeyRound,
  Landmark, Mail, Network, Phone, Server, Shield, Users, Wrench, type LucideIcon,
} from "lucide-react";
import { resolveSectionIcon, type SectionIconId } from "@/lib/section-icons";

export const SECTION_ICON_COMPONENTS: Record<SectionIconId, LucideIcon> = {
  folder: Folder, mail: Mail, phone: Phone, server: Server, shield: Shield,
  network: Network, key: KeyRound, finance: Landmark, document: FileText,
  home: Home, work: BriefcaseBusiness, tool: Wrench, code: Code2, globe: Globe2,
  users: Users, archive: Archive,
};

export function SectionIcon({ value, ...props }: { value: unknown; size?: number; className?: string }) {
  const Icon = SECTION_ICON_COMPONENTS[resolveSectionIcon(value)];
  return <Icon {...props} />;
}
