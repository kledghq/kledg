# Modes d'affichage et menu personnalisé

Le guide d'utilisation (choisir son mode, menu du mode standard, personnaliser son menu) est sur le site : [Mode simple, standard ou expert](https://www.kledg.com/fr/docs/le-mode-simple). Cette page décrit le fonctionnement technique : code, API, stockage, droits et tests.

Kledg affiche les mêmes livres de trois façons, au choix de chaque
utilisateur, et chacun peut en plus masquer des entrées de son menu, société
par société. Ni le mode ni le menu ne donnent ou ne retirent un droit : ce
que chacun peut faire dépend toujours de son rôle dans la société
(`lib/permissions.ts`), contrôlé par chaque route de l'API.

## Les trois modes

| Mode | Pour qui | Pages, mots, accueil | Menu latéral |
|---|---|---|---|
| Simple | sans jargon comptable | pages simples sous `/simple`, vocabulaire sans jargon, accueil `/<société>/simple` ([mode-simple.md](mode-simple.md)) | `simpleNavGroups` |
| Standard | les pages du quotidien | celles du mode expert : mêmes pages, mêmes mots, tableau de bord `/<société>` | `standardNavGroups` : les entrées expertes dont l'URL est dans `STANDARD_NAV_URLS` |
| Expert | toutes les pages | toutes les pages | `navGroups` |

Le mode est enregistré dans `user_preferences.displayMode` (`'simple'`,
`'standard'`, `'expert'`, contrainte `user_preferences_displayMode_check`,
migration `20261118090000_sidebar_preferences`), `NULL` tant que
l'utilisateur n'a pas choisi, lu comme `'expert'`. Les valeurs déjà
enregistrées ne changent pas. `PUT /api/account/display-mode` accepte
`{ mode: 'simple' | 'standard' | 'expert' }`.

Le choix se fait aux trois mêmes endroits, avec les trois options et leur
ligne de description (`DISPLAY_MODE_DESCRIPTIONS`,
`lib/appearance/display-mode.ts`) : le menu « Affichage » (icône en forme
d'œil de la barre du haut), la dernière étape de l'assistant de création de
société et la carte « Mode d'affichage » de Paramètres, Apparence. Choisir
Standard ouvre le tableau de bord de la société, ou la Synthèse du groupe
depuis l'espace groupe, comme Expert.

### Menu du mode Standard

Défini comme une donnée (`STANDARD_NAV_URLS`,
`components/layout/nav-config.ts`) : les entrées du menu expert dont l'URL
est dans la liste, dans l'ordre du menu expert, filtrées comme lui (entrées
`holdingOnly` et `feature`). Une page ajoutée au menu expert reste donc hors
de Standard tant qu'elle n'est pas ajoutée à la liste.

| Groupe | Entrées |
|---|---|
| | Tableau de bord |
| Banque | Comptes bancaires, Transactions, Rapprochement, Justificatifs |
| Factures | Factures d'achat, Factures de vente, Tiers, Notes de frais, Mes notes de frais |
| Saisie | Écritures |
| États | Bilan, Compte de résultat, Échéances, Déclarations de TVA, Impôt sur les sociétés |
| Société | Informations, Membres |

« Mes notes de frais » suit le menu expert, qui la montre à chaque membre.
Dans l'espace groupe, Standard garde les pages expertes avec un menu réduit
(`STANDARD_GROUP_NAV_URLS`, `components/layout/group-nav-config.ts`) :
Pilotage (Synthèse), Structure (Organigramme), Trésorerie (Soldes et
perspectives), Fiscalité (Impôt sur les sociétés, Échéances).

Une page que Standard ne liste pas reste accessible par son adresse et par
les liens des autres pages. Le fil d'Ariane et le titre de l'onglet
cherchent les titres dans le menu expert (`titleNavGroupsFor`), et le menu
ne met alors aucune entrée en évidence plutôt qu'une voisine plus courte.

### Ce qui distingue Standard d'Expert

Seul le menu. Partout ailleurs, Standard se comporte comme Expert ; le code
demande le vocabulaire du mode (`vocabularyOf(mode)`, `'simple'` ou
`'expert'`) plutôt que de comparer à `'expert'` :

| Endroit | Standard |
|---|---|
| Accueil de la société (`companyHomePath`, `app/(company)/[companyId]/page.tsx`) | le tableau de bord, pas de redirection vers `/simple` |
| Accueil du groupe (`groupHomePath`, `GROUP_HOME`, `app/(company)/[companyId]/group/page.tsx`) | `/<holding>/group` |
| Fil d'Ariane (`dashboard-breadcrumb.tsx`) | titres et sections du menu expert, « Tableau de bord » |
| Prévision de trésorerie (`prevision-tresorerie/page.tsx`) | les mots experts |
| Compteurs du menu simple (`useSimpleCounts`) | non chargés |
| Accueil simple, vérification du jargon | jamais |

## Menu personnalisé

Chacun peut masquer des entrées et des groupes entiers de son menu, pour
lui seul et pour une société à la fois, par-dessus le menu de son mode.
« Personnaliser le menu », en bas du menu latéral (aussi dans le tiroir sur
téléphone), ouvre l'éditeur :

- un interrupteur par groupe et une case par entrée du menu du mode, pour
  cette société (le nom de la société est rappelé) ;
- chaque changement s'applique aussitôt au menu et s'enregistre ; un échec
  remet le menu comme avant et dit pourquoi ;
- « Afficher tout » rétablit le menu complet ;
- l'entrée d'accueil (Tableau de bord, Accueil du mode simple) est toujours
  affichée et son groupe n'a pas d'interrupteur ; « Personnaliser le menu »
  n'est pas une entrée : on peut toujours revenir ;
- la page courante porte « Page actuelle » ; la masquer est possible,
  l'éditeur explique qu'elle reste ouverte.

Sur une page masquée, le menu n'en met aucune autre en évidence et affiche
« Page masquée du menu » avec un lien « Réafficher » (qui réaffiche aussi
son groupe). Une page masquée reste accessible par son adresse, par les
liens et garde son titre dans le fil d'Ariane. L'espace groupe n'a pas
d'éditeur : son menu est court.

### Stockage

Table `sidebar_preferences` (`SidebarPreference`) : `userId`, `companyId`,
`hiddenItems` (URL relatives des entrées masquées, `/banking/statements`),
`hiddenGroups` (identifiants stables des groupes, `NavGroup.id` :
`banque`, `factures`, `saisie`, `etats`, `societe`), `createdAt`,
`updatedAt`, unique par utilisateur et société. Sans ligne, tout le menu du
mode s'affiche ; « Afficher tout » supprime la ligne.

Les identifiants ne sont jamais des libellés. Une entrée masquée l'est dans
chaque mode qui la liste (même URL). Les identifiants inconnus (page retirée
depuis, faute de frappe) sont ignorés à l'écriture et à la lecture
(`sanitizeSidebarHidden`, `components/layout/sidebar-menu.ts`), jamais une
erreur. Le corps est validé par `SidebarPreferencesBody`
(`lib/navigation/sidebar-preferences.ts`) : forme des identifiants, au plus
120 entrées et 20 groupes, aucun autre champ (un `userId` est refusé).

Le layout des sociétés charge les menus de l'utilisateur pour les sociétés
du sélecteur (`listSidebarPreferences`), sans requête de plus côté
navigateur ni clignotement du menu.

### API

| Route | Droit | Effet |
|---|---|---|
| `GET /api/companies/[id]/sidebar-preferences` | `settings:read` (tout rôle) | le menu de l'utilisateur dans la société |
| `PUT /api/companies/[id]/sidebar-preferences` | `settings:read` (tout rôle), même origine, limite `sidebar-preferences` | `{ hiddenItems, hiddenGroups }` remplace le menu ; deux listes vides rétablissent tout |

Un non-membre reçoit 404. Les requêtes sont toujours clés par l'utilisateur
de la session : aucune ne lit ni n'écrit le menu d'un autre. La sécurité au
niveau des lignes fait de même (classe « société et utilisateur » de
[rls.md](rls.md), comme `dashboard_layouts`). Serveur MCP : préférence de
l'interface, exclue (`ui`, [mcp.md](mcp.md)).

## Tests

- `lib/appearance/__tests__/display-mode.test.ts`, `display-mode.db.test.ts` : lecture, validation et persistance de `'standard'` ;
- `components/layout/__tests__/standard-navigation.test.tsx` : menu Standard exact, titres des pages masquées, accueil, groupe, sélecteur ;
- `components/layout/__tests__/sidebar-menu.test.tsx` : nettoyage des identifiants, éditeur, rendu dans chaque mode, page courante masquée ;
- `lib/navigation/__tests__/sidebar-preferences.db.test.ts` : API (le sien seulement, isolation des sociétés, validation, identifiants inconnus) ;
- `lib/rls/__tests__/tenant-isolation.db.test.ts` et `policy-coverage.db.test.ts` : politiques de la table.
