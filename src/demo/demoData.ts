import { addDays, format, startOfDay, subDays } from 'date-fns';
import type {
  CompletedItem, Item, Label, Project, Section, Snapshot, TodoistUser,
} from '@/domain/types';
import { emptySnapshot } from '@/domain/types';
import type { Locale } from '@/i18n';

/**
 * A made-up account, so the product can be shown or tried without connecting
 * anyone's real Todoist.
 *
 * Everything here is invented for the demo: no name, project or task is taken
 * from a real account. The snapshot lives in memory only, and the store
 * refuses to send commands or cache anything while it is loaded.
 */

/** Deterministic per session, so a demo can be talked through without it shifting. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Copy {
  person: string;
  email: string;
  /** Todoist accounts get one of these at most; "My projects" (personal) isn't one. */
  workspace: string;
  projects: {
    inbox: string;
    personal: string;
    home: string;
    site: string;
    siteDescription: string;
    homeDescription: string;
    clients: string;
    clientA: string;
    clientB: string;
  };
  sections: Array<{ name: string; description?: string }>;
  parent: { title: string; description: string; children: string[] };
  tasks: Array<[string, string]>;
  completed: string[];
}

const COPY: Record<Locale, Copy> = {
  fr: {
    person: 'Camille Durand',
    email: 'camille@demo.test',
    workspace: 'Studio Camille',
    projects: {
      inbox: 'Boîte de réception',
      personal: 'Perso',
      home: 'Logement',
      site: 'Site vitrine',
      siteDescription:
        'Refonte complète du site.\n\n- Nouvelle grille\n- Textes raccourcis\n- Blog migré',
      homeDescription: 'Entretien, courses et petites réparations.',
      clients: 'Missions',
      clientA: 'Librairie Vermeil',
      clientB: 'Studio Ardoise',
    },
    sections: [
      { name: 'À faire', description: 'Tout ce qui est prêt à démarrer.' },
      { name: 'En cours', description: 'Deux tâches maximum ici, sinon plus rien n’avance.' },
      { name: 'À relire' },
    ],
    parent: {
      title: 'Refonte de la page d’accueil',
      description: 'Trois blocs, une seule idée par bloc.',
      children: ['Écrire les textes', 'Choisir les images', 'Intégrer la maquette'],
    },
    tasks: [
      ['Relire le devis avant envoi', 'Vérifier les quantités et **la date de validité**.'],
      ['Préparer la réunion de lancement', '- Rappeler le contexte\n- Présenter le planning\n- Lister les décisions à prendre'],
      ['Envoyer la facture du mois', ''],
      ['Choisir la police du site', 'Comparer deux familles sur un écran réel, pas dans l’éditeur.'],
      ['Arroser les plantes', ''],
      ['Sortir le recyclage', ''],
      ['Sauvegarder les photos', 'Copier sur le disque externe puis vérifier un fichier au hasard.'],
      ['Appeler le garage', ''],
      ['Mettre à jour le portfolio', 'Ajouter les deux derniers projets et raccourcir les textes.'],
      ['Lire le rapport du trimestre', ''],
      ['Réserver le train de novembre', 'Éviter la correspondance de moins de vingt minutes.'],
      ['Trier la boîte mail', ''],
      ['Préparer la démonstration', 'Un sujet par écran, finir par les prochaines étapes.'],
      ['Automatiser les relances', ''],
      ['Attendre le retour du syndic', ''],
      ['Corriger le formulaire de contact', 'Le champ téléphone accepte encore du texte.'],
      ['Écrire la note de cadrage', 'Contexte, décision attendue, options, recommandation.'],
      ['Ranger le bureau', ''],
      ['Préparer le déjeuner de samedi', ''],
      ['Revoir les estimations', ''],
      ['Publier l’article sur les habitudes', 'Relire à voix haute avant de publier.'],
      ['Changer les draps', ''],
      ['Vérifier les sauvegardes', ''],
      ['Planifier les congés', ''],
      ['Commander les cartes de visite', ''],
    ],
    completed: [
      'Relire la proposition', 'Envoyer le devis', 'Appeler la banque', 'Ranger le dressing',
      'Mettre à jour le CV', 'Publier la lettre d’information', 'Payer la cotisation',
      'Réparer le vélo', 'Trier les photos', 'Préparer la réunion', 'Faire les courses',
      'Répondre aux candidatures', 'Nettoyer la base de données', 'Relancer le client',
      'Écrire le compte-rendu', 'Réserver le restaurant', 'Renouveler le domaine',
    ],
  },
  en: {
    person: 'Robin Hale',
    email: 'robin@demo.test',
    workspace: 'Robin Studio',
    projects: {
      inbox: 'Inbox',
      personal: 'Personal',
      home: 'Home',
      site: 'Website',
      siteDescription:
        'Full rebuild of the site.\n\n- New grid\n- Shorter copy\n- Blog migrated',
      homeDescription: 'Upkeep, shopping and small repairs.',
      clients: 'Client work',
      clientA: 'Vermilion Books',
      clientB: 'Slate Studio',
    },
    sections: [
      { name: 'To do', description: 'Everything ready to start.' },
      { name: 'In progress', description: 'Two tasks here at most, or nothing moves.' },
      { name: 'To review' },
    ],
    parent: {
      title: 'Rebuild the home page',
      description: 'Three blocks, one idea each.',
      children: ['Write the copy', 'Choose the images', 'Build the layout'],
    },
    tasks: [
      ['Check the quote before sending', 'Verify the quantities and **the expiry date**.'],
      ['Prepare the kick-off meeting', '- Recap the context\n- Walk through the plan\n- List the decisions needed'],
      ['Send this month’s invoice', ''],
      ['Choose the site typeface', 'Compare two families on a real screen, not in the editor.'],
      ['Water the plants', ''],
      ['Take out the recycling', ''],
      ['Back up the photos', 'Copy to the external drive, then open one file to check.'],
      ['Call the garage', ''],
      ['Update the portfolio', 'Add the last two projects and cut the copy back.'],
      ['Read the quarterly report', ''],
      ['Book the November train', 'Avoid any connection under twenty minutes.'],
      ['Clear the mailbox', ''],
      ['Prepare the demo', 'One subject per screen, finish with next steps.'],
      ['Automate the reminders', ''],
      ['Waiting on the building manager', ''],
      ['Fix the contact form', 'The phone field still accepts letters.'],
      ['Write the scoping note', 'Context, decision needed, options, recommendation.'],
      ['Tidy the desk', ''],
      ['Plan Saturday lunch', ''],
      ['Revisit the estimates', ''],
      ['Publish the piece on habits', 'Read it aloud before publishing.'],
      ['Change the bedding', ''],
      ['Check the backups', ''],
      ['Plan the time off', ''],
      ['Order business cards', ''],
    ],
    completed: [
      'Review the proposal', 'Send the quote', 'Call the bank', 'Sort the wardrobe',
      'Update the CV', 'Publish the newsletter', 'Pay the subscription',
      'Fix the bike', 'Sort the photos', 'Prepare the meeting', 'Do the shopping',
      'Reply to applicants', 'Clean the database', 'Follow up with the client',
      'Write the notes', 'Book the restaurant', 'Renew the domain',
    ],
  },
};

export function buildDemoSnapshot(locale: Locale = 'en', seed = 20260914): Snapshot {
  const copy = COPY[locale] ?? COPY.en;
  const random = makeRandom(seed);
  const today = startOfDay(new Date());
  const iso = (d: Date) => format(d, 'yyyy-MM-dd');

  const projects: Record<string, Project> = {};
  const addProject = (
    id: string, name: string, color: string, order: number,
    extra: Partial<Project> = {},
  ) => {
    projects[id] = {
      id, name, color, parent_id: null, child_order: order,
      is_archived: false, is_deleted: false, is_favorite: false,
      workspace_id: null, ...extra,
    };
  };

  /* One workspace — Todoist's own limit on a non-Business account — for the
     client work, so there is something for a workspace filter to narrow.
     "Perso" and "Logement" carry no `workspace_id` at all: My projects is
     the absence of a workspace, not a workspace of its own, and Inbox never
     joins one either. */
  const workspaces = {
    'ws-pro': { id: 'ws-pro', name: copy.workspace, logo_big: null },
  };

  addProject('inbox', copy.projects.inbox, 'charcoal', 0, { inbox_project: true });
  addProject('personal', copy.projects.personal, 'orange', 1, { is_favorite: true });
  addProject('home', copy.projects.home, 'green', 2, { description: copy.projects.homeDescription });
  addProject('site', copy.projects.site, 'blue', 3, {
    is_favorite: true,
    description: `${copy.projects.siteDescription}\n\n<!-- icon:briefcase -->`,
    workspace_id: 'ws-pro',
  });
  addProject('clients', copy.projects.clients, 'grey', 4, { is_folder: true, workspace_id: 'ws-pro' });
  addProject('client-a', copy.projects.clientA, 'grape', 5, { parent_id: 'clients', workspace_id: 'ws-pro' });
  addProject('client-b', copy.projects.clientB, 'teal', 6, { parent_id: 'clients', workspace_id: 'ws-pro' });

  const sections: Record<string, Section> = {};
  ['s-todo', 's-doing', 's-review'].forEach((id, index) => {
    const source = copy.sections[index];
    sections[id] = {
      id,
      project_id: 'site',
      name: source.name,
      section_order: index,
      is_archived: false,
      is_deleted: false,
      ...(source.description ? { description: source.description } : {}),
    };
  });

  const labels: Record<string, Label> = {
    l1: { id: 'l1', name: 'quick', color: 'sky_blue', item_order: 1, is_deleted: false, is_favorite: true },
    l2: { id: 'l2', name: 'week', color: 'olive_green', item_order: 2, is_deleted: false, is_favorite: false },
    l3: { id: 'l3', name: 'automation', color: 'grape', item_order: 3, is_deleted: false, is_favorite: true },
    l4: { id: 'l4', name: 'waiting', color: 'charcoal', item_order: 4, is_deleted: false, is_favorite: true },
  };

  const items: Record<string, Item> = {};
  let counter = 0;

  const addItem = (partial: Partial<Item> & { content: string }): Item => {
    counter += 1;
    const item: Item = {
      id: `demo-${counter}`,
      user_id: 'demo-user',
      project_id: 'inbox',
      section_id: null,
      parent_id: null,
      description: '',
      priority: 1,
      due: null,
      deadline: null,
      duration: null,
      labels: [],
      child_order: counter,
      day_order: -1,
      collapsed: false,
      checked: false,
      is_deleted: false,
      added_at: subDays(today, Math.floor(random() * 60)).toISOString(),
      completed_at: null,
      updated_at: today.toISOString(),
      responsible_uid: null,
      ...partial,
      content: partial.content,
    };
    items[item.id] = item;
    return item;
  };

  const due = (date: Date, time?: string, recurring?: string) => ({
    date: time ? `${iso(date)}T${time}` : iso(date),
    timezone: null,
    string: recurring ?? iso(date),
    lang: locale,
    is_recurring: !!recurring,
  });

  const everyWeek = locale === 'fr' ? 'tous les lundis' : 'every Monday';
  const everyDay = locale === 'fr' ? 'tous les jours' : 'every day';

  // A spread that exercises every rule: overdue, quick, timed, week, backlog.
  const plan: Array<Partial<Item>> = [
    { due: due(subDays(today, 4)), priority: 4, labels: ['est-40'] },
    { due: due(subDays(today, 1)), priority: 3, labels: ['est-25'] },
    { due: due(today), priority: 2, labels: ['quick', 'est-10'] },
    { due: due(today), priority: 1, labels: ['est-3'], project_id: 'home' },
    { due: due(today, undefined, everyWeek), priority: 1, labels: ['est-5'], project_id: 'home' },
    { due: due(today, '14:00:00', everyDay), priority: 3, labels: ['est-60'] },
    { due: due(today, '09:30:00'), priority: 2, labels: ['est-30'], project_id: 'client-a' },
    { labels: ['week', 'est-90'], priority: 4, project_id: 'site', section_id: 's-doing' },
    { labels: ['week', 'est-45'], priority: 3, project_id: 'site', section_id: 's-todo' },
    { labels: ['week'], priority: 2, project_id: 'site', section_id: 's-todo' },
    { due: due(addDays(today, 1)), priority: 3, labels: ['est-20'] },
    { due: due(addDays(today, 2)), priority: 4, labels: ['est-120'], deadline: { date: iso(addDays(today, 6)), lang: locale } },
    { due: due(addDays(today, 3)), priority: 1, labels: ['est-15'], project_id: 'client-b' },
    { due: due(addDays(today, 5)), priority: 2, project_id: 'site', section_id: 's-review' },
    { due: due(addDays(today, 9)), priority: 1, labels: ['est-45'], project_id: 'personal' },
    { labels: ['automation'], priority: 2, project_id: 'personal' },
    { labels: ['waiting'], priority: 1, project_id: 'home' },
    { priority: 1, project_id: 'personal' },
    { priority: 1, labels: ['est-25'], project_id: 'home' },
    { priority: 2, project_id: 'site', section_id: 's-todo', labels: ['est-60'] },
    { priority: 1, project_id: 'client-a' },
    { priority: 3, project_id: 'client-b', labels: ['est-180'] },
    { priority: 1 },
    { priority: 1, labels: ['est-30'], project_id: 'personal' },
    { priority: 1, project_id: 'home' },
  ];

  plan.forEach((shape, index) => {
    const [content, description] = copy.tasks[index % copy.tasks.length];
    addItem({ content, description, ...shape } as Partial<Item> & { content: string });
  });

  // One parent with subtasks, so hierarchy and rolled-up estimates are visible.
  const parent = addItem({
    content: copy.parent.title,
    description: copy.parent.description,
    project_id: 'site',
    section_id: 's-doing',
    priority: 4,
    labels: ['week'],
  });
  const childEstimates = ['est-45', 'est-30', 'est-120'];
  copy.parent.children.forEach((title, index) => {
    addItem({
      content: title,
      parent_id: parent.id,
      project_id: 'site',
      section_id: 's-doing',
      labels: [childEstimates[index]],
    });
  });

  // A couple of deliberate contradictions, so the conflicts centre has content.
  addItem({
    content: copy.tasks[1][0],
    project_id: 'personal',
    priority: 3,
    due: due(addDays(today, 2)),
    labels: ['week', 'est-45'],
  });
  addItem({
    content: copy.tasks[17][0],
    project_id: 'personal',
    priority: 1,
    labels: ['quick', 'est-25'],
  });

  const user: TodoistUser = {
    id: 'demo-user',
    email: copy.email,
    full_name: copy.person,
    inbox_project_id: 'inbox',
    tz_info: { timezone: 'Europe/Paris', hours: 2, minutes: 0, is_dst: 1 },
    start_day: 1,
    is_premium: true,
    karma: 23480,
    image_id: null,
  };

  return {
    ...emptySnapshot(),
    items,
    projects,
    sections,
    labels,
    workspaces,
    user,
    syncToken: 'demo',
    syncedAt: Date.now(),
  };
}

/** A year of plausible history, so Insights has something to chart. */
export function buildDemoCompleted(locale: Locale = 'en', seed = 20260914): CompletedItem[] {
  const copy = COPY[locale] ?? COPY.en;
  const random = makeRandom(seed + 7);
  const today = startOfDay(new Date());
  const projectIds = ['inbox', 'personal', 'home', 'site', 'client-a', 'client-b'];
  const out: CompletedItem[] = [];
  let id = 0;

  for (let daysAgo = 0; daysAgo < 365; daysAgo += 1) {
    const date = subDays(today, daysAgo);
    const weekday = date.getDay();
    // Fewer completions at weekends, and a gentle decline further back.
    const base = weekday === 0 || weekday === 6 ? 1.5 : 5;
    const count = Math.max(0, Math.round(base * (0.5 + random()) * (daysAgo > 120 ? 0.6 : 1)));

    for (let i = 0; i < count; i += 1) {
      id += 1;
      const hour = 8 + Math.floor(random() * 11);
      const at = new Date(date);
      at.setHours(hour, Math.floor(random() * 60), 0, 0);
      const minutes = [5, 10, 15, 25, 30, 45, 60, 90][Math.floor(random() * 8)];
      out.push({
        id: `done-${id}`,
        user_id: 'demo-user',
        project_id: projectIds[Math.floor(random() * projectIds.length)],
        section_id: null,
        content: copy.completed[Math.floor(random() * copy.completed.length)],
        completed_at: at.toISOString(),
        priority: (1 + Math.floor(random() * 4)) as 1 | 2 | 3 | 4,
        labels: [
          ...(random() > 0.35 ? [`est-${minutes}`] : []),
          ...(id % 3 === 0 ? ['quick'] : []),
          ...(id % 7 === 0 ? ['automation'] : []),
          ...(id % 11 === 0 ? ['waiting'] : []),
        ],
      });
    }
  }

  return out;
}
