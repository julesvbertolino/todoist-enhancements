import { useEffect, useMemo, useState } from 'react';
import { Icon } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { BulkBar } from './components/BulkBar';
import { DragProvider } from './components/dnd/DragProvider';
import { Composer } from './components/overlays/Composer';
import { TaskDetail } from './components/overlays/TaskDetail';
import { Issues } from './components/overlays/Issues';
import { Search } from './components/overlays/Search';
import { Shortcuts } from './components/overlays/Shortcuts';
import { InsightsPanel } from './components/overlays/InsightsPanel';
import { ProjectSheet, type ProjectSheetTarget } from './components/overlays/ProjectSheet';
import { Unestimated } from './components/overlays/Unestimated';
import { ConfirmProvider } from './components/overlays/Confirm';
import { Overlay } from './components/overlays/Overlay';
import { WeekView } from './views/WeekView';
import { UpcomingView } from './views/UpcomingView';
import { SimpleListView } from './views/SimpleListView';
import { ProjectView } from './views/ProjectView';
import { LabelsView } from './views/LabelsView';
import { InsightsView } from './views/InsightsView';
import { ReviewView } from './views/ReviewView';
import { SettingsView } from './views/SettingsView';
import { EisenhowerView } from './views/EisenhowerView';
import { ConnectView } from './views/ConnectView';
import { Walkthrough } from './components/overlays/Walkthrough';
import { Tour } from './components/overlays/Tour';
import { hasOnboarded } from './domain/onboarding';
import { useStore } from './store/store';
import type { Accent, Theme } from './store/prefs';
import { ACCENT_TOKENS, accentFamily, hexToHsl } from './domain/accent';
import { useT } from './hooks/useT';
import { useKeyboard } from './hooks/useKeyboard';
import { useData } from './hooks/useData';
import { navigate, useRoute, type Route } from './hooks/useRoute';
import { rootItems } from './store/selectors';
import { detectConflicts } from './domain/conflicts';
import { anytimeItems, bucketOf, hasLabel, somedayItems, upcomingItems, weekItems } from './domain/views';
import { effectiveEstimate } from './domain/estimates';
import type { TranslationKey } from './i18n';

export function App() {
  const { t } = useT();
  const ready = useStore((s) => s.ready);
  const connected = useStore((s) => s.connected);
  const init = useStore((s) => s.init);
  const startPolling = useStore((s) => s.startPolling);
  const locale = useStore((s) => s.prefs.locale);
  const homepage = useStore((s) => s.prefs.homepage);
  const theme = useStore((s) => s.prefs.theme);
  const accent = useStore((s) => s.prefs.accent);
  const accentCustom = useStore((s) => s.prefs.accentCustom);
  const userId = useStore((s) => s.snapshot.user?.id);
  const demo = useStore((s) => s.demo);
  const walkthroughOpen = useStore((s) => s.walkthrough);
  const [tourOpen, setTourOpen] = useState(false);
  const [onboardingStarted, setOnboardingStarted] = useState(false);
  const setWalkthrough = useStore((s) => s.setWalkthrough);
  const beginTourPreview = useStore((s) => s.beginTourPreview);
  const endTourPreview = useStore((s) => s.endTourPreview);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);

  const route = useRoute();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /** What was typed on the page before the search took it. */
  const [searchSeed, setSearchSeed] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  /* Not a boolean: what the sheet was opened to do — create one here, or edit
     that one — is carried by the open state itself. */
  const [projectSheet, setProjectSheet] = useState<ProjectSheetTarget>(null);
  const [unestimatedOpen, setUnestimatedOpen] = useState(false);
  /** The sidebar, shown as a page. There is no room for a column on a phone. */
  const [browseOpen, setBrowseOpen] = useState(false);
  /** Where a newly composed task should land, when it was added from a section. */
  const [placement, setPlacement] = useState<ComposerPlacement>({});

  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    if (!tourOpen) return;
    beginTourPreview();
    return endTourPreview;
  }, [tourOpen, beginTourPreview, endTourPreview]);

  /* The address bar wins, always — a shared or reopened link must land where
     it says. The homepage only fills in when there is nothing to obey. */
  useEffect(() => {
    if (ready && !window.location.hash.replace(/^#\/?/, '')) navigate(homepage);
  }, [ready, homepage]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => applyTheme(theme), [theme]);
  /* Also on `theme`: a custom accent is two families, and which one is
     written depends on the scheme that ended up resolved. */
  useEffect(() => applyAccent(accent, accentCustom), [accent, accentCustom, theme]);
  useEffect(() => (connected ? startPolling() : undefined), [connected, startPolling]);
  useEffect(() => {
    const replay = () => {
      setWalkthrough(false);
      navigate('week');
      window.setTimeout(() => setTourOpen(true), 60);
    };
    window.addEventListener('enhanced:replay-onboarding', replay);
    return () => window.removeEventListener('enhanced:replay-onboarding', replay);
  }, [setWalkthrough]);

  /* The first run — for a real account that has not had one, and for the demo,
     which is where most people meet this app first and is exactly where a tour
     has something to point at.

     Opened here and closed by the dialog, so asking for it again from Settings
     goes through the same door. */
  useEffect(() => {
    if (ready && (connected || demo) && !hasOnboarded(userId) && !onboardingStarted) {
      setOnboardingStarted(true);
      navigate('week');
      window.setTimeout(() => setTourOpen(true), 100);
    }
  }, [ready, connected, demo, userId, onboardingStarted]);

  if (!ready) {
    return <div className="connect"><p className="empty">{t('common.loading')}</p></div>;
  }

  if (!connected) {
    return <ConnectView />;
  }

  return (
    <>
      <ConfirmProvider>
        <DragProvider>
          <AppShell
            route={route}
            openTaskId={openTaskId}
            setOpenTaskId={setOpenTaskId}
            composerOpen={composerOpen}
            setComposerOpen={setComposerOpen}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            searchSeed={searchSeed}
            openSearch={(seed) => { setSearchSeed(seed); setSearchOpen(true); }}
            shortcutsOpen={shortcutsOpen}
            setShortcutsOpen={setShortcutsOpen}
            issuesOpen={issuesOpen}
            setIssuesOpen={setIssuesOpen}
            insightsOpen={insightsOpen}
            setInsightsOpen={setInsightsOpen}
            projectSheet={projectSheet}
            setProjectSheet={setProjectSheet}
            unestimatedOpen={unestimatedOpen}
            setUnestimatedOpen={setUnestimatedOpen}
            browseOpen={browseOpen}
            setBrowseOpen={setBrowseOpen}
            placement={placement}
            setPlacement={setPlacement}
          />
        </DragProvider>
      </ConfirmProvider>

      {/* Outside the shell, and above it. The choices it offers change the
          page behind it, which is the point of showing them here. */}
      <Walkthrough
        open={walkthroughOpen}
        onDone={() => setWalkthrough(false)}
      />
      <Tour
        open={tourOpen}
        onDone={() => {
          setTourOpen(false);
          setWalkthrough(true);
        }}
      />

      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((toast) => (
            <div className="toast" key={toast.id}>
              <span>{toast.message}</span>
              {toast.undo && (
                <button onClick={() => { toast.undo?.(); dismissToast(toast.id); }}>
                  {t('common.undo')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

interface ShellProps {
  route: Route;
  openTaskId: string | null;
  setOpenTaskId: (id: string | null) => void;
  composerOpen: boolean;
  setComposerOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /** What had already been typed when the search was opened by typing. */
  searchSeed: string;
  openSearch: (seed: string) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  issuesOpen: boolean;
  setIssuesOpen: (open: boolean) => void;
  insightsOpen: boolean;
  setInsightsOpen: (open: boolean) => void;
  projectSheet: ProjectSheetTarget;
  setProjectSheet: (target: ProjectSheetTarget) => void;
  unestimatedOpen: boolean;
  setUnestimatedOpen: (open: boolean) => void;
  browseOpen: boolean;
  setBrowseOpen: (open: boolean) => void;
  placement: ComposerPlacement;
  setPlacement: (placement: ComposerPlacement) => void;
}

export interface ComposerPlacement {
  projectId?: string;
  sectionId?: string;
  date?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
}

/**
 * Writes a concrete light or dark scheme onto the document.
 *
 * The stylesheet is never asked what the device prefers: `data-theme` always
 * names one of the two real themes, and resolving "system" — including
 * following the device when it changes its mind mid-session — happens here.
 * One place decides, so there is one dark palette rather than two that drift.
 *
 * The resolved choice is mirrored into local storage because index.html reads
 * it before the first paint. Without that the page opens white and turns dark
 * a moment later, once preferences have loaded out of IndexedDB.
 */
function applyTheme(theme: Theme): (() => void) | undefined {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    root.dataset.theme = resolved;
    try { localStorage.setItem('theme', theme); } catch { /* storage may be blocked */ }
    paintBrowserChrome();
  };
  apply();
  // Only "system" is a standing question. A fixed choice has nothing to listen for.
  if (theme !== 'system') return undefined;
  media.addEventListener('change', apply);
  return () => media.removeEventListener('change', apply);
}

/**
 * Writes the chosen brand colour onto the document.
 *
 * Only the name travels. Which nine values that name stands for — and which
 * of its two schemes applies — is the stylesheet's business, which is what
 * keeps a green accent from being a green mark on surfaces still tinted red.
 */
function applyAccent(accent: Accent, custom: string): void {
  const root = document.documentElement;
  root.dataset.accent = accent;

  /* A named accent is nine families already written in the stylesheet. A
     custom one is built here, by the same recipe, and set as inline custom
     properties — which is also why they are cleared again on the way out, or
     the last custom colour would keep overriding the named one. */
  for (const token of ACCENT_TOKENS) root.style.removeProperty(`--${token}`);

  const hsl = accent === 'custom' ? hexToHsl(custom) : null;
  if (hsl) {
    const scheme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    for (const [token, value] of Object.entries(accentFamily(custom, scheme))) {
      root.style.setProperty(`--${token}`, value);
    }
  }

  try {
    localStorage.setItem('accent', accent);
    localStorage.setItem('accentCustom', custom);
    /* Both schemes, because index.html has to write these before the first
       paint and cannot run the recipe. It picks the one it needs once it has
       resolved the theme, the same way this function just did. */
    localStorage.setItem('accentVars', hsl
      ? JSON.stringify({
        light: accentFamily(custom, 'light'),
        dark: accentFamily(custom, 'dark'),
      })
      : '');
  } catch { /* storage may be blocked */ }
  paintBrowserChrome();
}

/**
 * Hands the accent to the browser's own chrome — the address bar on Android,
 * the task switcher, the title bar of an installed window.
 *
 * Read back off the document rather than mapped here, so there is still only
 * one place that knows what a colour name means. The manifest's `theme_color`
 * cannot follow: it is a static file read at install time, so it keeps the
 * default red and names the app rather than this device's preference.
 */
function paintBrowserChrome(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim();
  if (accent) meta.setAttribute('content', accent);
}

function AppShell({
  route, openTaskId, setOpenTaskId, composerOpen, setComposerOpen,
  searchOpen, setSearchOpen, searchSeed, openSearch, shortcutsOpen, setShortcutsOpen,
  issuesOpen, setIssuesOpen,
  insightsOpen, setInsightsOpen, projectSheet, setProjectSheet,
  unestimatedOpen, setUnestimatedOpen, browseOpen, setBrowseOpen,
  placement, setPlacement,
}: ShellProps) {
  const { t } = useT();
  const { snapshot, items, childrenOf } = useData();
  const conflictSettings = useStore((s) => s.prefs.conflicts);
  const demo = useStore((s) => s.demo);
  const sidebarCollapsed = useStore((s) => s.prefs.sidebarCollapsed);
  const weekLayout = useStore((s) => s.prefs.weekLayout);
  const density = useStore((s) => s.prefs.density);
  const leaveDemo = useStore((s) => s.disconnect);
  const clearSelection = useStore((s) => s.clearSelection);

  const roots = useMemo(() => rootItems(items), [items]);
  const conflictCount = useMemo(
    () => detectConflicts(roots, childrenOf, conflictSettings).length,
    [roots, childrenOf, conflictSettings],
  );

  /** Whatever the page in front is showing, so the dialogs never describe another one. */
  const { contextItems, contextLabel } = useMemo(() => {
    switch (route.view) {
      case 'project': {
        const project = route.id ? snapshot.projects[route.id] : undefined;
        return {
          contextItems: roots.filter((i) => i.project_id === route.id),
          contextLabel: project?.name ?? t('nav.projects'),
        };
      }
      case 'label':
        return {
          contextItems: route.id ? roots.filter((i) => hasLabel(i, route.id!)) : [],
          contextLabel: route.id ?? '',
        };
      case 'week':
        return {
          /* The page's own scope, or the header and every dialog opened from
             it would describe a week this page is not showing. */
          contextItems: weekLayout === 'split' ? anytimeItems(roots) : weekItems(roots),
          contextLabel: t('nav.week'),
        };
      case 'today': {
        const now = new Date();
        return {
          contextItems: roots.filter((i) => {
            const bucket = bucketOf(i, now);
            return bucket === 'overdue' || bucket === 'today';
          }),
          contextLabel: t('nav.today'),
        };
      }
      case 'upcoming':
        return { contextItems: upcomingItems(roots), contextLabel: t('nav.upcoming') };
      case 'review':
        return { contextItems: weekItems(roots), contextLabel: t('nav.review') };
      case 'someday':
        return { contextItems: somedayItems(roots), contextLabel: t('nav.someday') };
      case 'inbox': {
        const inboxId = snapshot.user?.inbox_project_id;
        return {
          contextItems: inboxId ? roots.filter((i) => i.project_id === inboxId) : [],
          contextLabel: t('nav.inbox'),
        };
      }
      case 'matrix':
        return { contextItems: roots, contextLabel: t('nav.matrix') };
      default:
        return { contextItems: roots, contextLabel: t(`nav.${route.view}` as TranslationKey) };
    }
  }, [route, roots, snapshot.projects, snapshot.user?.inbox_project_id, t, weekLayout]);

  const unestimatedItems = useMemo(
    () => contextItems.filter((i) => effectiveEstimate(i, childrenOf).minutes === null),
    [contextItems, childrenOf],
  );

  /* Every way out of the browse page is a navigation, so one effect closes it
     rather than each of its thirty buttons remembering to. */
  useEffect(() => setBrowseOpen(false), [route.view, route.id, route.sectionId, setBrowseOpen]);

  /* A selection belongs to the page it was made on. Carrying it to the next
     one would leave a bar offering to delete tasks that are no longer shown. */
  useEffect(() => clearSelection(), [route.view, route.id, route.sectionId, clearSelection]);

  useEffect(() => {
    document.querySelector<HTMLElement>('.screen.active')?.scrollTo({ top: 0 });
  }, [route.view, route.id]);

  /**
   * Whether the page's own heading has scrolled out of sight.
   *
   * Watched rather than measured on every scroll: the question is only ever
   * "is that element still on the screen", which is the one question an
   * intersection observer answers without running anything while nothing is
   * happening.
   */
  const [titleShown, setTitleShown] = useState(false);
  useEffect(() => {
    const screen = document.querySelector('.screen.active');
    const heading = screen?.querySelector('.ptitle');
    if (!screen || !heading) { setTitleShown(false); return; }
    const watch = new IntersectionObserver(
      ([entry]) => setTitleShown(!entry.isIntersecting),
      { root: screen, threshold: 0 },
    );
    watch.observe(heading);
    return () => watch.disconnect();
    // A new page brings a new heading to watch.
  }, [route.view, route.id]);

  const openTask = (id: string) => setOpenTaskId(id);
  const addTask = () => {
    setPlacement(route.view === 'project' && route.id ? { projectId: route.id } : {});
    setComposerOpen(true);
  };

  /* Every key the app answers, in one listener. It is called here rather than
     in `App` because deleting a task asks for confirmation, and the dialog
     that asks lives inside this shell. */
  useKeyboard({
    openTask,
    openSearch,
    openComposer: addTask,
    openShortcuts: () => setShortcutsOpen(true),
  });
  const addTaskTo = (next: ComposerPlacement) => {
    setPlacement(next);
    setComposerOpen(true);
  };
  const openInsights = () => setInsightsOpen(true);
  const openUnestimated = () => setUnestimatedOpen(true);
  const viewProps = {
    onOpen: openTask,
    onInsights: openInsights,
    onUnestimated: openUnestimated,
    onAddTaskTo: addTaskTo,
    onProjectSheet: setProjectSheet,
  };

  return (
    <div
      className={`app${demo ? ' demo' : ''}${sidebarCollapsed ? ' collapsed' : ''}`}
      data-density={density}
    >
      {demo && (
        <div className="demobanner" role="status">
          <Icon name="warning" size="sm" />
          <span>{t('demo.banner')}</span>
          <button onClick={() => void leaveDemo()}>{t('demo.exit')}</button>
        </div>
      )}
      <Sidebar
        route={route}
        onAddTask={addTask}
        onSearch={() => setSearchOpen(true)}
        onIssues={() => setIssuesOpen(true)}
        onProjectSheet={setProjectSheet}
        issuesCount={conflictCount}
      />

      <main className="workspace">
        <header className="mobile-top">
          {/* This opened My week, whatever it said. It opens the navigation. */}
          <button
            className="iconbtn"
            aria-label={t('nav.openNavigation')}
            onClick={() => setBrowseOpen(true)}
          >
            <Icon name="menu" />
          </button>
          {/* The page names itself twice on a phone — once in this bar and once
              as the heading under it — which costs a row of a short screen to
              say nothing. The bar holds the name back until the heading has
              scrolled away, which is the same title arriving where it is
              needed rather than a second one standing beside it. */}
          <strong className={titleShown ? ' shown' : ''}>{contextLabel}</strong>
          <button className="iconbtn" aria-label={t('nav.search')} onClick={() => setSearchOpen(true)}>
            <Icon name="search" />
          </button>
        </header>

        <section className="screen active">
          {route.view === 'week' && (
            <WeekView {...viewProps} scope={weekLayout === 'split' ? 'anytime' : 'all'} />
          )}
          {route.view === 'today' && <WeekView {...viewProps} scope="today" />}
          {route.view === 'upcoming' && <UpcomingView {...viewProps} />}
          {route.view === 'someday' && <SimpleListView kind="someday" {...viewProps} />}
          {route.view === 'inbox' && <SimpleListView kind="inbox" {...viewProps} />}
          {route.view === 'label' && route.id && (
            <SimpleListView kind="label" labelName={route.id} {...viewProps} />
          )}
          {route.view === 'labels' && <LabelsView />}
          {route.view === 'matrix' && (
            <EisenhowerView onOpen={openTask} onUnestimated={openUnestimated} />
          )}
          {route.view === 'project' && route.id && (
            <ProjectView projectId={route.id} revealSectionId={route.sectionId} {...viewProps} />
          )}
          {route.view === 'review' && <ReviewView onOpen={openTask} />}
          {route.view === 'insights' && <InsightsView />}
          {route.view === 'settings' && <SettingsView />}
        </section>

        <nav className="mobile-nav" aria-label={t('nav.projects')}>
          <button
            aria-current={route.view === 'inbox' ? 'page' : undefined}
            onClick={() => navigate('inbox')}
          >
            <Icon name="inbox" size="lg" />
            {t('nav.inbox')}
          </button>
          <button
            aria-current={route.view === 'week' ? 'page' : undefined}
            onClick={() => navigate('week')}
          >
            <Icon name="week" size="lg" />
            {t('nav.week')}
          </button>
          <button className="fab" aria-label={t('nav.addTask')} onClick={addTask}>
            {/* The stylesheet paints the round accent disc on this wrapper. */}
            <i><Icon name="plus" /></i>
          </button>
          <button
            aria-current={route.view === 'upcoming' ? 'page' : undefined}
            onClick={() => navigate('upcoming')}
          >
            <Icon name="upcoming" size="lg" />
            {t('nav.upcoming')}
          </button>
          {/* Browse was here and in the bar at the top of every page, which is
              one destination taking two of the five places a phone has. It
              stays at the top, where a burger menu is on every phone, and the
              slot it gives up goes to a destination: Someday, which was
              otherwise two taps away behind that same menu. */}
          <button
            aria-current={route.view === 'someday' ? 'page' : undefined}
            onClick={() => navigate('someday')}
          >
            <Icon name="someday" size="lg" />
            {t('nav.someday')}
          </button>
        </nav>
      </main>

      <Composer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        defaultProjectId={placement.projectId}
        defaultSectionId={placement.sectionId}
        defaultDate={placement.date}
        defaultLabels={placement.labels}
        defaultPriority={placement.priority}
      />
      <TaskDetail
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onOpen={openTask}
      />
      <Issues open={issuesOpen} onClose={() => setIssuesOpen(false)} onOpen={openTask} />
      <Search
        open={searchOpen}
        seed={searchSeed}
        onClose={() => setSearchOpen(false)}
        onOpen={openTask}
      />
      <Shortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ProjectSheet target={projectSheet} onClose={() => setProjectSheet(null)} />

      {/* The same sidebar, as a page. One list of destinations, not two that
          have to be kept in step. */}
      <Overlay
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        label={t('nav.browse')}
        size="full"
      >
        <div className="browse">
          <div className="browse-head">
            <strong>{t('nav.browse')}</strong>
            <button
              className="iconbtn"
              aria-label={t('common.close')}
              onClick={() => setBrowseOpen(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <Sidebar
            route={route}
            variant="sheet"
            onAddTask={() => { setBrowseOpen(false); addTask(); }}
            onSearch={() => { setBrowseOpen(false); setSearchOpen(true); }}
            onIssues={() => { setBrowseOpen(false); setIssuesOpen(true); }}
            onProjectSheet={(target) => { setBrowseOpen(false); setProjectSheet(target); }}
            issuesCount={conflictCount}
          />
        </div>
      </Overlay>
      <Unestimated
        open={unestimatedOpen}
        onClose={() => setUnestimatedOpen(false)}
        items={unestimatedItems}
        onOpen={openTask}
      />
      <BulkBar />
      <InsightsPanel
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        contextLabel={contextLabel}
        items={contextItems}
        onOpenTask={openTask}
      />
    </div>
  );
}
