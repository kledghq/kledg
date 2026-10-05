# Mode simple

Kledg propose deux façons d'afficher les mêmes livres :

- **Simple**, pour les personnes qui ne sont pas comptables : leur argent,
  leurs dépenses, ce qu'on leur doit et ce qu'elles doivent, sans jargon ;
- **Expert**, l'interface complète : écritures, journaux, plan comptable,
  grand livre, balance, lettrage, clôture, bilan, liasse et FEC.

Le mode est une **préférence d'affichage de l'utilisateur**, pas de la
société : deux membres d'une même société peuvent travailler l'un en mode
simple, l'autre en mode expert. Les comptes restent les mêmes ; seul
l'affichage change. **Le mode ne donne et ne retire aucun droit** : ce que
chacun peut faire dépend toujours de son rôle dans la société
(`lib/permissions.ts`), contrôlé par chaque route de l'API.

## Choisir son mode

| Où | Comment |
|---|---|
| Premier lancement | Dernière étape de l'assistant de création de société, « Comment voulez-vous utiliser Kledg ? », avec les deux cartes Simple et Expert. Proposée à un utilisateur qui n'a encore choisi aucun mode et n'est membre d'aucune société (`shouldAskDisplayMode`) : l'administrateur d'une nouvelle instance après `/welcome`, un utilisateur inscrit sur une instance qui le laisse créer sa société. La société existe déjà à cette étape : la note sur l'expert-comptable mène à la page Membres pour l'inviter. |
| Barre latérale | Le sélecteur « Affichage » Simple / Expert, en bas de la barre latérale d'une société ; il ouvre l'accueil du mode choisi. Masqué quand la barre est réduite aux icônes. |
| Paramètres, Apparence | La carte « Mode d'affichage », enregistrée tout de suite comme le thème. |

Un utilisateur qui n'a jamais choisi est en mode **expert** : les
utilisateurs existants ne voient aucun changement.

## Ce qui change en mode simple

### Navigation

La barre latérale (`simpleNavGroups`, `components/layout/nav-config.ts`)
devient :

| Entrée | Page |
|---|---|
| Accueil | `/<société>/simple`, l'accueil du mode simple (ci-dessous) |
| Dépenses | `/<société>/simple/depenses`, les dépenses à vérifier, avec leur nombre |
| Recettes | Factures de vente |
| Factures | Factures d'achat |
| Banque | Comptes bancaires |
| Justificatifs | Justificatifs manquants |
| Mon comptable | Membres de la société |

La racine d'une société (`/<société>`) ouvre l'accueil simple au lieu du
tableau de bord, sauf pour un lien qui porte des paramètres (le guide de
démarrage, `?guide=`). Les pages expertes restent accessibles par leur
adresse : elles ne sont simplement pas listées. Le fil d'Ariane et le titre
de l'onglet suivent la navigation du mode.

Le nombre affiché à côté de « Dépenses » vient de
`GET /api/companies/[id]/simple/counts` (droit `banking:read`) : pour
l'instant, les débits bancaires de la société pas encore rapprochés
(`lib/simple/count-expenses-to-check.service.ts`). La page des dépenses à
vérifier le remplace par son propre décompte ; une page qui change ce
nombre envoie l'évènement `simple:counts-refresh` pour que la barre
latérale le relise.

### Accueil

`app/(company)/[companyId]/simple/page.tsx`, données de
`lib/simple/load-simple-home.service.ts`. Aucun calcul financier n'y est
écrit : chaque chiffre vient d'un service déjà utilisé par les écrans
experts, et les tests (`lib/simple/__tests__/load-simple-home.db.test.ts`)
les comparent aux états au centime.

| Bloc | Source | Droit |
|---|---|---|
| Argent sur vos comptes | Soldes déclarés par les banques, comptes en euros (comptes remplacés par une connexion directe exclus), source `bank-accounts` du tableau de bord ; variation du mois : crédits moins débits des opérations bancaires en euros depuis le premier jour du mois | `banking:read` |
| Vos clients vous doivent | Total des clients de la balance âgée (`getAgedBalance`) à la date du jour dans l'exercice, et la part échue | `reports:read` |
| TVA à payer le ... | Prochaine échéance de TVA du calendrier (`lib/deadlines`) ; montant de la déclaration de sa période, calculé comme la page Déclarations de TVA (`lib/vat-returns/vat-return-for-deadline.service.ts`, [déclarations de TVA](declarations-tva.md)) quand ses contrôles passent, avec « D'après votre déclaration de septembre 2026 » ; sinon estimé d'après les comptes 445 (crédit moins débit, `summarizeLedger`) et présenté comme une estimation à confirmer. Un montant négatif s'affiche « TVA en votre faveur » | `reports:read` |
| Bénéfice depuis ... (mois de début de l'exercice) | Résultat de l'exercice d'après les écritures validées, hors écritures de clôture, comme le compte de résultat (`loadStatementAccounts`, `computeSig`), avant l'impôt sur les bénéfices (comptes 69 sauf 691, ligne 2053 HK) | `reports:read` |
| Impôt sur les sociétés estimé | L'impôt de l'exercice en cours sur les écritures passées, calculé comme la page Impôt sur les sociétés (`estimateCorporateTax`, [impôt sur les sociétés](impot-societes.md)) sans les dividendes de filiales, avec « Estimation sur le bénéfice depuis janvier, à confirmer à la clôture » ; absent pour une société à l'impôt sur le revenu ou sans régime | `reports:read` |
| À faire | Dépenses à vérifier (lien vers `simple/depenses`), justificatifs manquants de l'exercice (`listMissingReceipts`), les trois clients les plus en retard de la balance âgée | `banking:read`, `reports:read` |
| Votre comptable | Les membres de la société au rôle Comptable ; sans comptable, un lien pour l'inviter depuis la page Membres. L'avancement de ses validations s'affichera ici quand la validation des dépenses du mode simple existera | `settings:read` |

Un bloc que les rôles de l'utilisateur ne permettent pas de lire n'est pas
affiché.

### Vocabulaire

Les phrases du mode simple sont dans `lib/simple/vocabulary.ts` (pur) :
dates en toutes lettres, pluriels, « dont 2 400,00 € en retard »,
« Relancer Studio Nord pour ... ». Aucun numéro de compte ni terme
comptable (écriture, journal, lettrage, débit, exercice, charges,
produits...) : la liste `SIMPLE_MODE_JARGON` est vérifiée par les tests du
vocabulaire et du rendu de l'accueil.

## Stockage

Colonne `displayMode` de `user_preferences` (migration
`20261031090000_user_display_mode`), à côté des couleurs des graphiques :
`'simple'`, `'expert'` (contrainte `user_preferences_displayMode_check`), ou
`NULL` tant que l'utilisateur n'a pas choisi, lu comme `'expert'`. La
colonne `appearance` devient facultative : une ligne qui ne porte que le
mode se lit avec les couleurs par défaut. Les politiques de sécurité au
niveau des lignes de `user_preferences` (la ligne est celle de l'utilisateur
qui agit, [rls.md](rls.md)) couvrent la nouvelle colonne.

| Route | Effet |
|---|---|
| `GET /api/account/display-mode` | `{ mode, chosen }` de l'utilisateur connecté |
| `PUT /api/account/display-mode` | `{ mode: 'simple' \| 'expert' }`, même origine, limite `account-appearance` |
| `GET /api/companies/[id]/simple/counts` | `{ expensesToCheck }`, droit `banking:read` |

## Tests

- `lib/appearance/__tests__/display-mode.test.ts`, `display-mode.db.test.ts` :
  valeur par défaut, persistance, couleurs conservées, contrainte de la base,
  étape proposée au premier lancement seulement.
- `lib/api/__tests__/authorization-matrix.test.ts` : chaque rôle choisit son
  propre mode et garde les mêmes refus ; compteur lisible par tous les
  membres, 404 hors de la société.
- `components/layout/__tests__/simple-navigation.test.tsx` : navigation de
  chaque mode, compteur, sélecteur, fil d'Ariane.
- `components/features/onboarding/__tests__/display-mode-step.test.tsx` et
  `company-wizard.test.tsx` : l'étape du premier lancement.
- `app/(company)/[companyId]/__tests__/home-page.test.ts` : racine de la
  société selon le mode.
- `lib/simple/__tests__/load-simple-home.db.test.ts`,
  `vocabulary.test.ts` : chiffres de l'accueil comparés aux états, droits,
  vocabulaire sans jargon.
