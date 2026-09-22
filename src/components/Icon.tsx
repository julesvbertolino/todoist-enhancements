import type { CSSProperties } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpDown, BarChart3, Bell, Calendar, CalendarClock,
  CalendarDays, Check, ChevronDown, ChevronUp, Clock, Coffee, CornerDownRight,
  ExternalLink, Filter, Flag, Folder, GripVertical, Group, Inbox,
  Kanban, Layers, LayoutDashboard, Lightbulb, List, LogOut, Menu,
  MessageSquare, MoreHorizontal, PanelLeft, PanelTop, Pencil, Plus, Repeat,
  Search, Settings, SlidersHorizontal, Star, Tag, Target, TrendingUp,
  TriangleAlert, Upload, X, ListChecks,
  type LucideIcon,
} from 'lucide-react';

/** Every glyph in the product, named exactly as it was under the old sprite. */
export type IconName =
  | 'arrow-left' | 'arrow-right' | 'bars' | 'bell' | 'board' | 'calendar'
  | 'caret' | 'caret-up' | 'check' | 'clock' | 'close' | 'coffee' | 'comment'
  | 'dashboard' | 'deadline' | 'drag' | 'edit' | 'export' | 'external'
  | 'filter' | 'flag' | 'group' | 'inbox' | 'list' | 'logout' | 'menu' | 'more'
  | 'plus' | 'project' | 'repeat' | 'search' | 'settings' | 'sidebar'
  | 'section' | 'sliders' | 'someday' | 'sort' | 'stack' | 'star' | 'subtask'
  | 'tag' | 'tasks'
  | 'trend' | 'upcoming' | 'warning' | 'week';

/** Lucide (MIT, lucide.dev) — chosen to replace the app's hand-drawn sprite. */
const ICONS: Record<IconName, LucideIcon> = {
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  bars: BarChart3,
  bell: Bell,
  board: Kanban,
  calendar: Calendar,
  caret: ChevronDown,
  'caret-up': ChevronUp,
  check: Check,
  clock: Clock,
  close: X,
  coffee: Coffee,
  comment: MessageSquare,
  dashboard: LayoutDashboard,
  deadline: Target,
  drag: GripVertical,
  edit: Pencil,
  export: Upload,
  external: ExternalLink,
  filter: Filter,
  flag: Flag,
  group: Group,
  inbox: Inbox,
  list: List,
  logout: LogOut,
  menu: Menu,
  more: MoreHorizontal,
  plus: Plus,
  project: Folder,
  repeat: Repeat,
  search: Search,
  settings: Settings,
  sidebar: PanelLeft,
  section: PanelTop,
  sliders: SlidersHorizontal,
  someday: Lightbulb,
  sort: ArrowUpDown,
  stack: Layers,
  star: Star,
  subtask: CornerDownRight,
  tag: Tag,
  tasks: ListChecks,
  trend: TrendingUp,
  upcoming: CalendarClock,
  warning: TriangleAlert,
  week: CalendarDays,
};

interface IconProps {
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Lets a caller tint a glyph, for project and tag markers. */
  style?: CSSProperties;
  title?: string;
}

export function Icon({ name, size = 'md', className, style, title }: IconProps) {
  const sizeClass = size === 'sm' ? ' ic-sm' : size === 'lg' ? ' ic-lg' : '';
  const Glyph = ICONS[name];
  return (
    <Glyph
      className={`ic${sizeClass}${className ? ` ${className}` : ''}`}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
    </Glyph>
  );
}
