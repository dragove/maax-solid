import type { Component } from "solid-js";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Box,
  Building2,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  Cpu,
  Download,
  Eye,
  ExternalLink,
  FolderOpen,
  Gift,
  GripVertical,
  HardDrive,
  Info,
  LayoutDashboard,
  Link,
  ListTodo,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  Moon,
  Play,
  Plus,
  Power,
  PowerOff,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  Server,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Sun,
  Swords,
  Terminal,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  Wrench,
  X,
  type IconNode,
} from "lucide";

const ICONS: Record<string, IconNode> = {
  activity: Activity,
  "alert-triangle": AlertTriangle,
  "book-open": BookOpen,
  box: Box,
  building: Building2,
  camera: Camera,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  clock: Clock,
  compass: Compass,
  copy: Copy,
  cpu: Cpu,
  download: Download,
  eye: Eye,
  "external-link": ExternalLink,
  "folder-open": FolderOpen,
  gift: Gift,
  "grip-vertical": GripVertical,
  "hard-drive": HardDrive,
  info: Info,
  dashboard: LayoutDashboard,
  link: Link,
  "list-todo": ListTodo,
  loader: LoaderCircle,
  "more-horizontal": MoreHorizontal,
  minus: Minus,
  moon: Moon,
  play: Play,
  plus: Plus,
  power: Power,
  "power-off": PowerOff,
  radio: Radio,
  "refresh-cw": RefreshCw,
  "scan-line": ScanLine,
  search: Search,
  server: Server,
  settings: Settings,
  "shopping-bag": ShoppingBag,
  sliders: SlidersHorizontal,
  smartphone: Smartphone,
  sparkles: Sparkles,
  square: Square,
  sun: Sun,
  swords: Swords,
  terminal: Terminal,
  "trash-2": Trash2,
  users: Users,
  wifi: Wifi,
  "wifi-off": WifiOff,
  wrench: Wrench,
  x: X,
};

export type IconName = string;

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

const renderNode = (node: IconNode[number]): string => {
  const [tag, attrs, children] = node as unknown as [string, Record<string, unknown>, IconNode | undefined];
  const attributes = Object.entries(attrs ?? {})
    .map(([key, value]) => {
      const name = key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
      return `${name}="${escapeAttribute(String(value))}"`;
    })
    .join(" ");
  const inner = children ? children.map(renderNode).join("") : "";
  return `<${tag}${attributes ? ` ${attributes}` : ""}>${inner}</${tag}>`;
};

const markupCache = new Map<string, string>();
const markupFor = (name: string): string => {
  const cached = markupCache.get(name);
  if (cached !== undefined) return cached;
  const icon = ICONS[name] ?? ICONS.box ?? [];
  const markup = icon.map(renderNode).join("");
  markupCache.set(name, markup);
  return markup;
};

interface IconProps {
  readonly name: IconName;
  readonly class?: string;
  readonly size?: number;
  readonly strokeWidth?: number;
}

export const Icon: Component<IconProps> = (props) => (
  <svg
    class={props.class ?? "icon"}
    width={props.size ?? "1em"}
    height={props.size ?? "1em"}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={props.strokeWidth ?? 1.8}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    innerHTML={markupFor(props.name)}
  />
);
