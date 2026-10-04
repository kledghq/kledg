# Serveur MCP : connecter Claude ou ChatGPT

Chaque instance Kledg expose un serveur [MCP](https://modelcontextprotocol.io) sur `https://votre-instance/api/mcp`. Votre assistant peut alors lire votre comptabilité et proposer des écritures, sans que vos données ne transitent par un service tiers autre que l'assistant que vous choisissez.

## Connexion

| Client | Méthode |
| --- | --- |
| Claude (claude.ai, apps) | Paramètres, Connecteurs, *Ajouter un connecteur personnalisé*, URL du serveur. Authentification OAuth automatique. |
| ChatGPT | Paramètres, Applications et connecteurs, créer un connecteur avec l'URL et l'authentification OAuth. |
| Claude Code | `claude mcp add --transport http kledg https://votre-instance/api/mcp --header "Authorization: Bearer kledg_..."` |
| Scripts, autres clients | En-tête `Authorization: Bearer <clé API>` ou `x-api-key`. |

Dans Kledg, les **Paramètres** du compte ont deux pages :

- **Assistants IA** (`/settings/assistants`) : l'URL exacte du serveur, la marche à suivre pour Claude, ChatGPT et Claude Code, et les assistants autorisés avec l'accès, le mode d'exécution et les sociétés de chacun, leur modification et leur révocation ;
- **Clés API** (`/settings/api-keys`) : la création d'une clé (niveau, mode d'exécution, sociétés) et les clés actives, avec leur modification et leur révocation.

## Autorisations

- OAuth 2.1 avec PKCE, enregistrement dynamique des clients (RFC 7591) et documents de métadonnées client (CIMD). Les jetons sont liés à la ressource `/api/mcp` (RFC 8707) et vérifiés par signature.
- Trois portées : `kledg:read` (lecture, obligatoire), `kledg:write` (proposer des écritures en brouillon) et `kledg:admin` (contrôle total : agir comme l'utilisateur, au-delà des brouillons ; implique les deux autres).
- Les jetons d'accès sont des JWT de courte durée, renouvelés par un jeton de rafraîchissement (portée `offline_access`). À chaque requête, `/api/mcp` vérifie aussi que l'autorisation de l'utilisateur pour cet assistant existe toujours et quelles portées elle accorde : un jeton ne donne jamais plus que l'autorisation en cours.
- L'assistant agit avec les droits de l'utilisateur qui l'a autorisé, société par société (mêmes rôles que l'interface), et seulement sur les sociétés choisies pour lui.
- Une clé API agit avec les droits de son propriétaire, au niveau d'accès et sur les sociétés choisis pour elle.
- Une clé API est limitée à 300 appels par minute. Une clé supprimée ou désactivée est refusée dès l'appel suivant ; sa date de dernière utilisation est mise à jour au plus une fois par minute.
- Aucun niveau ne donne plus que vos rôles : le contrôle total permet seulement à l'assistant de faire ce que vous pouvez faire vous-même dans chaque société choisie.

## Choisir l'accès d'un assistant

La page d'autorisation propose jusqu'à trois niveaux, parmi ceux que l'assistant demande :

- **Lecture seule** : portée `kledg:read`. Les jetons émis ne contiennent pas `kledg:write`, et l'outil `create_draft_entry` n'apparaît pas dans la liste d'outils de l'assistant.
- **Lecture et brouillons d'écritures** (présélectionné) : portées `kledg:read` et `kledg:write`. L'assistant peut proposer des écritures avec `create_draft_entry` ; elles restent en brouillon jusqu'à ce qu'une personne les valide.
- **Contrôle total** : portées `kledg:read`, `kledg:write` et `kledg:admin`. L'assistant pourra agir comme vous : valider des écritures, rapprocher, importer, clôturer un exercice..., dans la limite de vos droits sur les sociétés choisies. Ce niveau n'est jamais présélectionné et s'accompagne d'un avertissement ; réservez-le à un assistant en qui vous avez toute confiance. Il se complète du choix du **mode d'exécution** (voir [Mode d'exécution du contrôle total](#mode-dexécution-du-contrôle-total)).

Les assistants demandent les trois portées ; seules celles que vous acceptez figurent dans les jetons. La page indique le compte Kledg connecté et le nom de l'assistant (son logo pour Claude et ChatGPT).

Le niveau choisi s'affiche dans **Assistants autorisés**. Il se modifie avec le bouton **Modifier** de l'assistant :

- **Réduire l'accès** (par exemple de Contrôle total à Lecture et brouillons, ou à Lecture seule) s'applique dès la requête suivante, sans reconnecter l'assistant : l'autorisation est mise à jour, ses jetons de rafraîchissement perdent les portées retirées et `/api/mcp` n'en tient plus compte, y compris pour un jeton d'accès émis avant le changement.
- **Augmenter l'accès** demande une nouvelle autorisation, car un jeton ne peut pas gagner une portée : déconnectez Kledg dans les paramètres de l'assistant (Claude, ChatGPT), connectez-le de nouveau et choisissez le niveau voulu sur la page d'autorisation.

Après une réduction, l'autorisation enregistrée ne couvre plus tout ce que l'assistant demande : à sa prochaine connexion complète, la page d'autorisation s'affiche de nouveau.

### Niveau des clés API

Une clé API reçoit son niveau à sa création (**Lecture et brouillons d'écritures** par défaut, jamais Contrôle total sans le choisir), et pour le contrôle total son mode d'exécution (**Automatique** par défaut), modifiable ensuite avec **Modifier**. Il est affiché dans la liste des clés ; pour en changer, créez une nouvelle clé et révoquez l'ancienne. Une clé sans niveau enregistré n'a que la lecture ; les clés créées avant l'ajout des niveaux ont reçu, par une migration, le niveau qu'elles avaient (lecture et brouillons).

### Pour les outils de contrôle total

Les outils qui agissent au-delà des brouillons (`lib/mcp/full-control`) ne sont enregistrés que si la connexion a le contrôle total (`access.canAdmin` dans `registerKledgTools`). Ils sont tous déclarés avec `fullControlTool` et enregistrés par `registerFullControlTool` (`lib/mcp/full-control/define.ts`), qui, à chaque appel et dans cet ordre :

1. vérifie la société avec `guard.requireFullControl(companyId, permission)` (`lib/mcp/company-access.ts`) : refus (403) sans `kledg:admin`, puis mêmes contrôles que les autres outils (sociétés choisies, rôle de l'utilisateur) ;
2. limite le nombre d'appels en contrôle total (60 par minute et par utilisateur, `lib/rate-limit.ts`) ;
3. exécute les actions à fort impact selon le mode d'exécution de la connexion : aussitôt en mode automatique, après votre approbation dans Kledg en mode validation (voir plus bas) ;
4. écrit l'action dans le journal d'audit, avec le mode d'exécution.

Chaque outil appelle le service de `lib/` que l'interface utilise (validation des écritures, rapprochement, import de relevés, clôture...) : mêmes contrôles, mêmes verrous, mêmes déclencheurs de la base. Un test de source (`lib/mcp/__tests__/tools.test.ts`) vérifie qu'aucun outil n'est enregistré autrement.

## Choisir les sociétés accessibles

Chaque connexion a sa liste de sociétés : un assistant autorisé par OAuth (par utilisateur) et chaque clé API.

- **Toutes mes sociétés, y compris les futures** (par défaut) : la connexion suit vos droits, y compris sur les sociétés auxquelles vous aurez accès plus tard. Les connexions créées avant ce choix ont reçu ce réglage, enregistré explicitement par une migration.
- **Seulement les sociétés choisies** : la connexion ne voit que ces sociétés. Une société ajoutée plus tard n'y est pas.

Sur la page d'autorisation, le choix part de **Toutes mes sociétés**, sauf si une autorisation précédente de cet assistant nommait des sociétés auxquelles vous avez encore accès. Si vous n'avez accès à aucune société, seul **Toutes mes sociétés** est proposé ; si vos sociétés ne peuvent pas être chargées, la page le dit au lieu d'afficher une liste vide.

Le choix se fait sur la page d'autorisation (à côté des droits demandés) quand vous connectez Claude ou ChatGPT, et à la création d'une clé API. Il se modifie ensuite à tout moment sur la page Assistants IA ou Clés API (bouton **Modifier** de l'assistant ou de la clé) et s'applique dès la requête suivante, sans reconnecter l'assistant.

Pour l'assistant, une société non choisie est introuvable, exactement comme une société dont vous n'êtes pas membre : `list_companies` ne la renvoie pas et tout outil appelé avec son identifiant (ou celui d'un exercice, d'une écriture, d'un compte ou d'une transaction de cette société) répond « Société introuvable » ou « Exercice introuvable ». `create_draft_entry` exige à la fois la portée `kledg:write` et une société choisie.

Le choix est toujours enregistré (page d'autorisation, création de la clé) : une connexion sans choix enregistré n'accède à aucune société. Supprimer une clé supprime aussi son choix de sociétés. Une société supprimée disparaît des listes. Le choix ne donne jamais plus de droits que les vôtres : vos rôles dans chaque société s'appliquent toujours.

## Révoquer un assistant

Le bouton **Révoquer** d'un assistant autorisé supprime, pour votre compte :

- votre autorisation pour cet assistant et son choix de sociétés ;
- ses jetons de rafraîchissement (et les jetons d'accès enregistrés) : l'assistant ne peut plus obtenir de nouveau jeton ;
- l'accès des jetons déjà émis : un jeton d'accès encore valide est refusé par `/api/mcp` dès la requête suivante (réponse 401 `invalid_token`), puisque l'autorisation n'existe plus.

Le nettoyage est fait par la base de données (déclencheurs sur la table des autorisations), quel que soit le chemin de la révocation. Les autres utilisateurs du même assistant ne sont pas concernés. Pour rétablir l'accès, reconnectez l'assistant : la page d'autorisation s'affiche de nouveau.

## Outils

### Lecture seule (`kledg:read`)

| Outil | Rôle |
| --- | --- |
| `list_companies` | Sociétés accessibles, régimes fiscaux, exercice en cours |
| `list_fiscal_years` | Exercices d'une société |
| `list_journals` | Journaux (AC, VE, BQ, OD, AN...) |
| `search_accounts` | Recherche dans le plan comptable |
| `get_trial_balance` | Balance générale entre deux dates |
| `get_balance_sheet` | Bilan d'un exercice |
| `get_income_statement` | Compte de résultat d'un exercice |
| `list_entries` | Écritures (avec leur identifiant), filtrables par date, journal, compte, statut |
| `list_bank_transactions` | Transactions bancaires, par défaut celles à rapprocher |
| `get_aged_balance` | Balance âgée à une date : créances clients (411) et dettes fournisseurs (401) non lettrées, par tiers et par ancienneté de l'échéance ([lettrage et tiers](lettrage-et-tiers.md)) ; droit `reports:read` |
| `list_missing_receipts` | Transactions bancaires sans justificatif, au-dessus d'un seuil, par exercice ou période et par compte ; droit `banking:read` |
| `list_tiers` | Clients et fournisseurs avec leur compte auxiliaire, leurs identifiants, comptes par défaut et délai de paiement ([factures et tiers](factures-et-tiers.md)) ; droit `entries:read` |
| `list_invoices` | Factures d'achat ou de vente, avec totaux, statut (brouillon, comptabilisée, payée partiellement, payée) et reste dû ; droit `entries:read` |
| `get_invoice` | Une facture avec ses lignes, son détail de TVA par taux, son écriture et ses règlements ; droit `entries:read` |
| `list_expense_reports` | Notes de frais avec bénéficiaire, période, total à rembourser, TVA récupérable et statut (brouillon, soumise, validée, comptabilisée, remboursée) ([notes de frais](notes-de-frais.md)) ; droit `entries:read`, puis seulement ses propres notes sans le droit de valider |
| `get_expense_report` | Une note de frais avec ses lignes, la TVA récupérable de chacune et sa raison, les trajets et le barème appliqué ; mêmes droits |
| `get_budget_report` | Budget d'un exercice comparé aux écritures validées : par ligne (début de compte de classe 6 ou 7), budget, réel, écart et pourcentage, comptes hors budget, totaux et résultat, jusqu'à un mois ou mois par mois ([budget](budget.md)) ; droit `reports:read` |
| `get_sig` | Soldes intermédiaires de gestion d'un exercice et de l'exercice précédent (marge commerciale, production, valeur ajoutée, EBE, résultats d'exploitation, courant, exceptionnel et de l'exercice, plus-values de cession) et capacité d'autofinancement, en euros ([indicateurs financiers](indicateurs-financiers.md)) ; droit `reports:read` |
| `get_financial_ratios` | Besoin en fonds de roulement, trésorerie nette, dettes financières, capitaux propres, délais de paiement clients et fournisseurs (DSO, DPO, TVA comprise), taux de marge, taux de marque, EBE et résultat rapportés au chiffre d'affaires, ratio d'endettement, exercice et exercice précédent ; droit `reports:read` |
| `list_detected_subscriptions` | Abonnements détectés dans les opérations bancaires : contrepartie, rythme, montant actuel, coût annuel, dernier et prochain paiement, statut (actif, prix modifié, peut-être arrêté), décision et ligne de budget ; salaires, charges sociales, impôts et emprunts sur demande ([abonnements](abonnements.md)) ; droit `banking:read` |
| `get_year_end_inventory` | Travaux de clôture d'un exercice : provisions et dépréciations (solde d'ouverture, montant requis, mouvement passé et à passer, comptes de dotation et de reprise, statut), subventions d'investissement (quote-part de l'exercice, reste en capitaux propres), totaux à comptabiliser ([provisions et subventions](provisions-et-subventions.md)) ; droit `reports:read` |
| `get_capital_composition` | Composition du capital : associés, titres, pourcentages, valeur nominale, seuil de 10 % des formulaires 2033-F et 2059-F, capital au compte 101 et contrôles, sans donnée personnelle ; droit `reports:read` |
| `get_year_end_formalities` | Approbation des comptes d'un exercice selon la forme juridique : qui décide et le titre du dirigeant, règle de majorité, délais d'approbation, de convocation et de dépôt, affectation du résultat proposée, résolutions et leur résultat, catégorie de taille, rapport de gestion, options de confidentialité, documents et données manquantes, liste du dépôt au greffe, sources ; droit `reports:read` |
| `list_management_fee_conventions` | Conventions de frais de gestion d'une holding avec ses filiales : prix, marge, clé de répartition, TVA ([frais de gestion](frais-de-gestion.md)) ; droit `reports:read` |
| `preview_management_fees` | Calcul des frais de gestion d'une période, montant HT, TVA et TTC de chaque filiale, sans rien facturer ; droit `reports:read` dans la holding et dans chaque filiale |
| `get_group_view` | Vue combinée d'une holding et de ses filiales pour un exercice : chiffre d'affaires, EBE, résultat, trésorerie, capitaux propres, endettement et total du bilan par société, agrégés et après élimination des flux intragroupe (frais de gestion, factures, comptes courants, prêts, dividendes), écarts, trésorerie par mois ; vue indicative, pas des comptes consolidés ([vue groupe](vue-groupe.md)) ; droit `reports:read` dans la holding et dans chaque filiale lue, les filiales hors de l'autorisation de l'assistant sont comptées, ni lues ni nommées |
| `get_participations` | Filiales et participations de la holding (2059-G-SD, 2033-G-SD) : catégorie, détention, valeur brute et nette des titres, capital, capitaux propres, quote-part, chiffre d'affaires, résultat, prêts et avances, dividendes ; mêmes droits |

### Lecture et brouillons d'écritures (`kledg:write`)

| Outil | Rôle |
| --- | --- |
| `create_draft_entry` | Proposer une écriture équilibrée, créée en **brouillon** |

À ce niveau, aucune écriture créée par un assistant n'est validée automatiquement : elle apparaît en brouillon dans Kledg et doit être validée par une personne.

### Contrôle total (`kledg:admin`)

L'assistant agit comme vous, dans la limite de votre rôle dans chaque société choisie. La colonne « Fort impact » indique les outils qui suivent le [mode d'exécution](#mode-dexécution-du-contrôle-total) de la connexion : exécutés aussitôt en mode automatique, approuvés dans Kledg en mode validation. Les autres s'exécutent toujours aussitôt.

| Outil | Rôle | Droit vérifié | Fort impact |
| --- | --- | --- | --- |
| `validate_entries` | Valider des brouillons : numéro définitif dans la suite de l'exercice, dans l'ordre des dates (PCG art. 1031-3) | `entries:validate` | Oui |
| `reverse_entry` | Contre-passer une écriture validée (date d'origine ou date choisie dans un exercice ouvert) | `entries:create, validate` | Oui |
| `update_draft_entry` | Modifier un brouillon (journal, date, libellé, lignes) ; une écriture validée est refusée | `entries:update` | Non |
| `delete_draft_entry` | Supprimer un brouillon ; une écriture validée est refusée | `entries:delete` | Oui |
| `reconcile_transaction` | Rapprocher une transaction : écriture en brouillon créée avec la ligne de banque, ou écriture existante, ou pointage sans écriture ; 409 si déjà rapprochée | `banking:reconcile` | Non |
| `unreconcile_transaction` | Annuler un rapprochement (supprime le brouillon qu'il a créé ; refusé si l'écriture est validée ou l'exercice clôturé) | `banking:reconcile` | Oui |
| `run_rules` | Exécuter les règles d'affectation sur les transactions à rapprocher | `banking:reconcile` | Oui |
| `list_rules` | Règles d'affectation, avec conditions et lignes | `banking:read` | Non |
| `create_rule`, `update_rule` | Créer ou remplacer une règle d'affectation | `ledger:manage` | Non |
| `delete_rule` | Supprimer une règle d'affectation | `ledger:manage` | Oui |
| `list_bank_accounts` | Connexions bancaires et comptes (identifiants pour `sync_bank` et `import_statement`) | `banking:read` | Non |
| `create_bank_account` | Ajouter un compte bancaire manuel, alimenté par relevés | `banking:manage` | Non |
| `sync_bank` | Synchroniser une connexion (Qonto, Revolut, Ponto) avec ce que le prestataire détient ; jamais de nouvelle actualisation Ponto, limite d'appels par société | `banking:reconcile` | Non |
| `import_statement` | Importer un relevé (CSV, Excel, OFX/QFX, camt.053) envoyé en base64 (5 Mo au plus) ; l'aperçu est l'analyse, doublons exacts et probables compris | `banking:reconcile` | Oui |
| `create_account` | Créer un compte, subdivision d'un compte existant de l'exercice | `ledger:manage` | Non |
| `create_journal` | Créer un journal | `ledger:manage` | Non |
| `create_fixed_asset` | Créer une immobilisation et son plan d'amortissement (contrôles PCG) | `ledger:manage` | Non |
| `generate_depreciation` | Générer les dotations de l'exercice (écritures validées, une par immobilisation) | `entries:create, validate` | Oui |
| `close_fiscal_year` | Clôturer l'exercice : résultat en 120 / 129, exercice suivant, à-nouveaux, verrouillage définitif | `closing:execute` | Oui |
| `allocate_result` | Affecter le résultat de l'exercice précédent (réserve légale, dividendes, autres réserves, report à nouveau) | `closing:execute` | Oui |
| `export_fec` | FEC de l'exercice (contenu du fichier) et rapport de conformité | `reports:export` | Non |
| `list_unlettered_lines` | Lignes non lettrées d'un compte de tiers (identifiants, montants, compte auxiliaire, solde progressif) et propositions de lettrage | `entries:read` | Non |
| `letter_entry_lines` | Lettrer des lignes d'un compte de tiers : code suivant du compte et date du jour, débits égaux aux crédits, écritures validées, exercice ouvert | `entries:update` | Oui |
| `unletter_entry_lines` | Délettrer un code d'un compte de tiers, dans un exercice ouvert | `entries:update` | Oui |
| `create_draft_invoice` | Enregistrer une facture d'achat ou de vente en brouillon (lignes, plusieurs taux, totaux calculés par Kledg) et, sur demande, son écriture en brouillon dans l'exercice de sa date | `entries:create` | Oui |
| `create_draft_expense_report` | Préparer une note de frais en brouillon à partir de justificatifs (dépenses, TVA récupérable calculée par Kledg) et de trajets (barème kilométrique de l'année) ; la personne la soumet et un valideur la comptabilise dans Kledg | `expenses:submit` | Oui |

Les opérations répétées n'agissent pas deux fois : un import du même relevé, une nouvelle exécution des règles, une seconde génération des dotations ou un second rapprochement ne créent rien de plus.

### Mode d'exécution du contrôle total

Chaque connexion en contrôle total (un assistant autorisé, pour votre compte, ou une clé API) a son mode d'exécution des outils à fort impact. Il se choisit sur la page d'autorisation quand vous choisissez Contrôle total, à la création d'une clé API, et se modifie avec le bouton **Modifier** ; la ligne de l'assistant ou de la clé l'affiche (« Contrôle total, exécution automatique »). Un changement s'applique dès l'appel suivant, sans reconnecter l'assistant.

- **Automatique** (par défaut, recommandé si vous faites confiance à l'assistant) : l'outil s'exécute dès l'appel, sans action en attente ni page d'approbation. L'assistant peut toujours demander un aperçu avec `dryRun: true` (rien n'est écrit) avant d'exécuter, mais ce n'est jamais obligatoire. La réponse d'une exécution est `{ executed: true, result }`.
- **Validation dans Kledg** : chaque action à fort impact attend votre approbation dans Kledg (voir plus bas).

Dans les deux modes restent appliqués : la portée `kledg:admin`, les sociétés choisies, votre rôle dans la société au moment de l'appel, la limite d'appels, le journal d'audit (qui nomme l'assistant et note « mode automatique » ou « validation dans Kledg ») et les invariants comptables des services et de la base (écritures validées définitives, exercices clôturés verrouillés, numérotation).

**Risque du mode automatique** : un texte malveillant présent dans vos données, par exemple un libellé bancaire ou un relevé, pourrait pousser l'assistant à agir à votre place (validation, suppression, clôture...), dans les limites ci-dessus. Kledg l'indique au moment du choix ; c'est un risque accepté (décision du mainteneur du 2026-10-04, voir [SECURITY.md](../SECURITY.md)). Choisissez **Validation dans Kledg** pour un assistant dont vous n'êtes pas sûr.

Les connexions qui existaient avant l'ajout du mode sont en mode automatique. La page **Actions IA à approuver** n'apparaît dans les paramètres que si l'une de vos connexions est en mode validation, ou si une action attend encore votre décision.

### Approbation dans Kledg (mode validation)

En mode validation, les outils à fort impact ne font rien tant que vous ne les avez pas approuvés **vous-même, dans Kledg**. L'assistant ne peut pas les approuver : un texte piégé lu par l'assistant (libellé bancaire, relevé, document) ne peut donc pas lui faire exécuter une validation, une clôture ou une suppression.

1. Appelés sans `actionId`, ils renvoient un aperçu (`dryRun: true`) de ce qui serait fait : écritures et numéros à attribuer, montants, soldes, analyse du relevé, simulation de la clôture, plan d'affectation, avertissements et blocages. Kledg enregistre une **action en attente** et renvoie son `actionId` et le lien `approvalUrl` de la page **Actions IA à approuver** (Paramètres).
2. L'assistant vous montre l'aperçu et vous donne le lien. Sur cette page, connecté à Kledg, vous voyez le même aperçu et les paramètres exacts, puis vous cliquez sur **Approuver** ou **Refuser** et saisissez de nouveau votre mot de passe.
3. Une fois l'action approuvée, l'assistant rappelle l'outil avec les **mêmes arguments** et l'`actionId`. L'action s'exécute alors, une seule fois.

L'action en attente est :

- liée à votre compte, à la connexion (assistant ou clé API), à l'outil, à la société et aux arguments de l'aperçu : avec d'autres arguments, un autre outil ou une autre société elle est refusée ; présentée par une autre connexion ou un autre utilisateur, elle est introuvable ;
- valable 30 minutes, pour l'approuver puis l'exécuter ;
- exécutée une seule fois : deux exécutions simultanées n'agissent qu'une fois, une seconde est refusée, une action refusée ne s'exécute jamais.

La page d'approbation (`POST /api/ai-actions/[id]`) n'accepte que la session de votre navigateur : ni les jetons OAuth des assistants ni les clés API ne l'authentifient. La requête doit venir de l'instance (en-têtes `Origin` et `Sec-Fetch-Site`) en JSON, et votre mot de passe est vérifié à chaque décision (limite de 20 tentatives par quart d'heure). Les actions sont conservées côté serveur (table `mcp_pending_actions`, `lib/mcp/full-control/pending-actions.ts`), avec leur aperçu, 30 jours.

Pourquoi l'assistant exécute l'action approuvée plutôt que Kledg au moment de l'approbation : l'exécution reste dans le chemin d'autorisation MCP (portée de la connexion, sociétés choisies, rôle de l'utilisateur au moment de l'exécution, limite d'appels, journal d'audit au nom de l'assistant) et le résultat revient à l'assistant comme un résultat d'outil ordinaire.

L'action exécutée passe par le service habituel, qui contrôle de nouveau l'état au moment de l'exécution : si les données ont changé depuis l'aperçu (une autre validation entre-temps, par exemple), le résultat peut différer de l'aperçu (numéros) ou l'action être refusée avec un message.

### Journal d'audit

Chaque action en contrôle total (pas les lectures `list_rules` et `list_bank_accounts`) écrit une entrée du journal d'audit, action `MCP_FULL_CONTROL`, avec :

- l'utilisateur (adresse e-mail et identifiant) ;
- l'assistant : nom du client OAuth (Claude, ChatGPT...) ou nom de la clé API, et son identifiant ;
- le mode d'exécution (`executionMode` : `automatic` ou `validation`, rappelé dans le message) ;
- l'outil et les identifiants principaux (écritures, numéros, transaction, règle, exercice, fichier...).

La préparation d'une action à approuver écrit `MCP_FULL_CONTROL_PENDING`, votre décision `MCP_ACTION_APPROVED` ou `MCP_ACTION_REJECTED`, et une exécution refusée (action non approuvée, refusée, déjà exécutée, expirée ou pour d'autres arguments) `MCP_FULL_CONTROL_REFUSED`. Les services écrivent en plus leurs propres entrées habituelles (clôture, affectation du résultat, rapprochement...).

### Ce que le contrôle total ne fait pas

Volontairement absents : suppression de société, gestion des membres et des rôles, paramètres de l'instance et mises à jour, connexion d'une banque et identifiants des prestataires, clés API et autorisations d'assistants, suppression ou réouverture d'exercice, mise en page des états. Ces actions restent dans l'interface.
