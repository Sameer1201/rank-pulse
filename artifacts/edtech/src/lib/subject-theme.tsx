import type { ComponentType, CSSProperties } from "react";
import {
  Activity,
  Binary,
  BookOpen,
  BrainCircuit,
  Braces,
  Calculator,
  CircuitBoard,
  ClipboardList,
  Compass,
  Cpu,
  Database,
  DraftingCompass,
  Factory,
  FileCode2,
  FlaskConical,
  Gauge,
  Hammer,
  HardDrive,
  Landmark,
  MonitorCog,
  Network,
  Orbit,
  Radio,
  Ruler,
  Settings2,
  SlidersHorizontal,
  ThermometerSun,
  TrainFront,
  Waves,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";

type IconType = ComponentType<{
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}>;

type SubjectDefinition = {
  key: string;
  color: string;
  icon: IconType;
  aliases: string[];
};

export type SubjectTheme = {
  key: string;
  color: string;
  icon: IconType;
  softBg: string;
  softBgStrong: string;
  softBorder: string;
  gradient: string;
};

const palette = {
  blue: "#315FC5",
  green: "#2C9A78",
  orange: "#E65A2A",
  pink: "#D64086",
  violet: "#7154C8",
  teal: "#168AA0",
  amber: "#C58A12",
  red: "#CF3F3F",
} as const;

const fallbackDefinitions: Array<Pick<SubjectDefinition, "color" | "icon">> = [
  { color: palette.blue, icon: Calculator },
  { color: palette.green, icon: CircuitBoard },
  { color: palette.orange, icon: Activity },
  { color: palette.pink, icon: Radio },
  { color: palette.violet, icon: HardDrive },
  { color: palette.teal, icon: Cpu },
  { color: palette.amber, icon: Gauge },
  { color: palette.red, icon: ThermometerSun },
];

// Chapter cards use their position within the chapter list so every visible
// chapter gets a distinct visual marker instead of inheriting the subject icon.
const chapterIcons: IconType[] = [
  BookOpen, Calculator, CircuitBoard, Cpu, Binary, Network, Radio, SlidersHorizontal,
  Database, Wifi, Orbit, FlaskConical, MonitorCog, FileCode2, Ruler, Gauge,
  Wrench, Factory, Landmark, Compass, TrainFront, Waves, ThermometerSun, Zap,
  BrainCircuit, Braces, DraftingCompass, Hammer, Activity, HardDrive, ClipboardList,
  Settings2,
];

const subjectDefinitions: SubjectDefinition[] = [
  {
    key: "overall",
    color: palette.blue,
    icon: ClipboardList,
    aliases: ["overall", "all subjects", "all review questions"],
  },
  {
    key: "general-aptitude",
    color: palette.pink,
    icon: BookOpen,
    aliases: [
      "general aptitude",
      "aptitude",
      "verbal",
      "quantitative",
      "reasoning",
      "general",
    ],
  },
  {
    key: "engineering-mathematics",
    color: palette.blue,
    icon: Calculator,
    aliases: [
      "engineering mathematics",
      "engineering maths",
      "engineering math",
      "mathematics",
      "maths",
      "math",
      "general mathematics",
    ],
  },
  {
    key: "technical",
    color: palette.green,
    icon: Cpu,
    aliases: ["technical", "core subject", "core", "major subject"],
  },
  {
    key: "physics",
    color: palette.blue,
    icon: Orbit,
    aliases: ["physics"],
  },
  {
    key: "chemistry",
    color: palette.orange,
    icon: FlaskConical,
    aliases: ["chemistry", "chemical"],
  },
  {
    key: "biology",
    color: palette.green,
    icon: BrainCircuit,
    aliases: ["biology", "botany", "zoology", "life science"],
  },
  {
    key: "network-theory",
    color: palette.green,
    icon: CircuitBoard,
    aliases: ["network theory", "networks", "network"],
  },
  {
    key: "signals-and-systems",
    color: palette.orange,
    icon: Activity,
    aliases: [
      "signals and systems",
      "signal and systems",
      "signal and system",
      "signals and system",
      "signal system",
      "signals systems",
      "signal processing",
    ],
  },
  {
    key: "electronic-devices",
    color: palette.teal,
    icon: Cpu,
    aliases: [
      "electronic devices",
      "electronic devices and circuits",
      "edc",
      "electronic device",
      "semiconductor devices",
    ],
  },
  {
    key: "analog-circuits",
    color: palette.orange,
    icon: Waves,
    aliases: [
      "analog circuits",
      "analog electronics",
      "analogue circuits",
      "analogue electronics",
      "ace",
      "analog",
    ],
  },
  {
    key: "digital-circuits",
    color: palette.blue,
    icon: Binary,
    aliases: [
      "digital circuits",
      "digital electronics",
      "digital logic",
      "dce",
      "digital",
    ],
  },
  {
    key: "control-systems",
    color: palette.green,
    icon: SlidersHorizontal,
    aliases: ["control systems", "control system", "control"],
  },
  {
    key: "communication-systems",
    color: palette.pink,
    icon: Radio,
    aliases: [
      "communication systems",
      "communication system",
      "communication",
      "communications",
      "analog communication",
      "digital communication",
      "comm",
    ],
  },
  {
    key: "electromagnetics",
    color: palette.violet,
    icon: Orbit,
    aliases: [
      "electromagnetics",
      "electromagnetic field theory",
      "emft",
      "emt",
      "electromagnetic theory",
      "electromagnetic fields",
      "electromagnetic waves",
    ],
  },
  {
    key: "computer-organization",
    color: palette.violet,
    icon: HardDrive,
    aliases: [
      "computer organization and architecture",
      "computer organization",
      "computer architecture",
      "coa",
      "co and a",
    ],
  },
  {
    key: "programming-and-data-structures",
    color: palette.green,
    icon: Braces,
    aliases: [
      "programming and data structures",
      "data structures",
      "programming",
      "dsa",
      "data structures and algorithms",
      "pds",
    ],
  },
  {
    key: "algorithms",
    color: palette.orange,
    icon: Network,
    aliases: ["algorithms", "algorithm", "algo"],
  },
  {
    key: "theory-of-computation",
    color: palette.pink,
    icon: BrainCircuit,
    aliases: ["theory of computation", "toc", "automata", "formal languages"],
  },
  {
    key: "compiler-design",
    color: palette.teal,
    icon: FileCode2,
    aliases: ["compiler design", "compiler", "cd"],
  },
  {
    key: "operating-systems",
    color: palette.violet,
    icon: MonitorCog,
    aliases: ["operating systems", "operating system", "os"],
  },
  {
    key: "database-management-systems",
    color: palette.green,
    icon: Database,
    aliases: [
      "database management systems",
      "dbms",
      "database systems",
      "database management",
      "database",
    ],
  },
  {
    key: "computer-networks",
    color: palette.blue,
    icon: Wifi,
    aliases: ["computer networks", "computer network", "cn", "networking"],
  },
  {
    key: "electrical-machines",
    color: palette.violet,
    icon: Settings2,
    aliases: ["electrical machines", "electrical machine", "em", "machines"],
  },
  {
    key: "power-systems",
    color: palette.amber,
    icon: Zap,
    aliases: ["power systems", "power system", "ps"],
  },
  {
    key: "measurements",
    color: palette.teal,
    icon: Gauge,
    aliases: [
      "electrical and electronic measurements",
      "measurements",
      "measurement",
      "instrumentation",
      "electrical measurements",
    ],
  },
  {
    key: "power-electronics",
    color: palette.red,
    icon: CircuitBoard,
    aliases: ["power electronics", "power electronic", "pe"],
  },
  {
    key: "engineering-mechanics",
    color: palette.green,
    icon: Wrench,
    aliases: ["engineering mechanics", "mechanics"],
  },
  {
    key: "strength-of-materials",
    color: palette.orange,
    icon: Ruler,
    aliases: [
      "strength of materials",
      "som",
      "mechanics of materials",
      "solid mechanics",
    ],
  },
  {
    key: "theory-of-machines",
    color: palette.violet,
    icon: Settings2,
    aliases: ["theory of machines", "tom", "kinematics", "dynamics of machines"],
  },
  {
    key: "machine-design",
    color: palette.blue,
    icon: DraftingCompass,
    aliases: ["machine design", "design of machine elements", "md"],
  },
  {
    key: "fluid-mechanics",
    color: palette.teal,
    icon: Waves,
    aliases: ["fluid mechanics", "fluid", "hydraulics", "hydrology", "fm"],
  },
  {
    key: "heat-transfer",
    color: palette.red,
    icon: ThermometerSun,
    aliases: ["heat transfer", "heat and mass transfer", "ht", "hmt"],
  },
  {
    key: "thermodynamics",
    color: palette.amber,
    icon: Gauge,
    aliases: ["thermodynamics", "thermo", "td"],
  },
  {
    key: "manufacturing-engineering",
    color: palette.green,
    icon: Factory,
    aliases: [
      "manufacturing engineering",
      "manufacturing",
      "production engineering",
      "manufacturing processes",
    ],
  },
  {
    key: "industrial-engineering",
    color: palette.orange,
    icon: Hammer,
    aliases: [
      "industrial engineering",
      "industrial",
      "operations research",
      "ie",
    ],
  },
  {
    key: "structural-analysis",
    color: palette.violet,
    icon: Landmark,
    aliases: ["structural analysis", "structures", "sa"],
  },
  {
    key: "geotechnical-engineering",
    color: palette.amber,
    icon: Landmark,
    aliases: ["geotechnical engineering", "geotechnical", "soil mechanics", "geo"],
  },
  {
    key: "environmental-engineering",
    color: palette.green,
    icon: FlaskConical,
    aliases: ["environmental engineering", "environmental", "env"],
  },
  {
    key: "irrigation-engineering",
    color: palette.teal,
    icon: Compass,
    aliases: [
      "irrigation engineering",
      "irrigation",
      "water resources",
      "hydrology",
    ],
  },
  {
    key: "transportation-engineering",
    color: palette.red,
    icon: TrainFront,
    aliases: [
      "transportation engineering",
      "transportation",
      "highway engineering",
      "traffic engineering",
    ],
  },
];

function normalizeLabel(label: string | null | undefined) {
  return String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function withAlpha(hex: string, alpha: number) {
  const cleaned = hex.replace("#", "");
  const full = cleaned.length === 3
    ? cleaned.split("").map((part) => `${part}${part}`).join("")
    : cleaned;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function fallbackTheme(label: string, index: number): SubjectDefinition {
  const choice = fallbackDefinitions[index % fallbackDefinitions.length];
  const key = normalizeLabel(label).replace(/\s+/g, "-") || `subject-${index + 1}`;
  return {
    key,
    color: choice.color,
    icon: choice.icon,
    aliases: [],
  };
}

export function getSubjectTheme(label: string | null | undefined, index = 0): SubjectTheme {
  const normalized = normalizeLabel(label);
  const matched = subjectDefinitions.find((definition) =>
    definition.aliases.some((alias) => normalized === alias || normalized.includes(alias)),
  ) ?? fallbackTheme(normalized, index);

  return {
    key: matched.key,
    color: matched.color,
    icon: matched.icon,
    softBg: withAlpha(matched.color, 0.08),
    softBgStrong: withAlpha(matched.color, 0.14),
    softBorder: withAlpha(matched.color, 0.24),
    gradient: `linear-gradient(to right, transparent, ${withAlpha(matched.color, 0.14)})`,
  };
}

export function getSubjectColor(label: string | null | undefined, index = 0) {
  return getSubjectTheme(label, index).color;
}

export function getSubjectAccent(label: string | null | undefined, index = 0) {
  const theme = getSubjectTheme(label, index);
  return {
    line: theme.color,
    border: theme.color,
    text: theme.color,
    bg: theme.softBg,
    badgeBg: theme.softBgStrong,
    badgeText: theme.color,
    gradient: theme.gradient,
  };
}

export function SubjectThemeIcon({
  label,
  index = 0,
  className = "h-4 w-4",
  strokeWidth = 2.15,
  color,
}: {
  label: string;
  index?: number;
  className?: string;
  strokeWidth?: number;
  color?: string;
}) {
  const theme = getSubjectTheme(label, index);
  const Icon = theme.icon;

  return <Icon className={className} strokeWidth={strokeWidth} style={{ color: color ?? theme.color }} />;
}

export function ChapterThemeIcon({
  label: _label,
  index = 0,
  className = "h-4 w-4",
  strokeWidth = 2.15,
  color,
}: {
  label: string;
  index?: number;
  className?: string;
  strokeWidth?: number;
  color?: string;
}) {
  const Icon = chapterIcons[Math.abs(index) % chapterIcons.length];
  return <Icon className={className} strokeWidth={strokeWidth} style={{ color }} />;
}
