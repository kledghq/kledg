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

- **Lecture seule** : portée `kledg:read`. Les jetons émis ne contiennent pas `kledg:write`, et aucun outil de brouillon (`create_draft_entry` et ceux de la section [Lecture et brouillons](#lecture-et-brouillons-kledgwrite)) n'apparaît dans la liste d'outils de l'assistant.
- **Lecture et brouillons d'écritures** (présélectionné) : portées `kledg:read` et `kledg:write`. L'assistant peut proposer des écritures avec `create_draft_entry` et préparer le travail que vous vérifiez ensuite dans Kledg : lignes de budget, décisions sur les abonnements, provisions et leur évaluation, subventions, écritures de clôture en brouillon, notes de frais en brouillon, données de l'approbation des comptes. Rien n'est validé ni comptabilisé : les écritures restent en brouillon jusqu'à ce qu'une personne les valide.
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

Pour l'assistant, une société non choisie est introuvable, exactement comme une société dont vous n'êtes pas membre : `list_companies` ne la renvoie pas et tout outil appelé avec son identifiant (ou celui d'un exercice, d'une écriture, d'un compte ou d'une transaction de cette société) répond « Société introuvable » ou « Exercice introuvable ». Les outils de brouillons exigent à la fois la portée `kledg:write` et une société choisie.

Le choix est toujours enregistré (page d'autorisation, création de la clé) : une connexion sans choix enregistré n'accède à aucune société. Supprimer une clé supprime aussi son choix de sociétés. Une société supprimée disparaît des listes. Le choix ne donne jamais plus de droits que les vôtres : vos rôles dans chaque société s'appliquent toujours.

## Révoquer un assistant

Le bouton **Révoquer** d'un assistant autorisé supprime, pour votre compte :

- votre autorisation pour cet assistant et son choix de sociétés ;
- ses jetons de rafraîchissement (et les jetons d'accès enregistrés) : l'assistant ne peut plus obtenir de nouveau jeton ;
- l'accès des jetons déjà émis : un jeton d'accès encore valide est refusé par `/api/mcp` dès la requête suivante (réponse 401 `invalid_token`), puisque l'autorisation n'existe plus.

Le nettoyage est fait par la base de données (déclencheurs sur la table des autorisations), quel que soit le chemin de la révocation. Les autres utilisateurs du même assistant ne sont pas concernés. Pour rétablir l'accès, reconnectez l'assistant : la page d'autorisation s'affiche de nouveau.

## Outils

### Conventions communes

- **Montants** : tout montant envoyé à un outil ou renvoyé par lui est en **euros**, nombre décimal à deux décimales au plus (`12.5` pour 12,50 €), jamais en centimes. Un montant à trois décimales est refusé avec un message en français. Les taux sont en pour cent (`20` pour 20 %), les ratios en fractions (`0.25` pour 25 %), les dates au format `AAAA-MM-JJ`, les mois `AAAA-MM`. Les outils convertissent à l'entrée et à la sortie (`lib/utils/money.ts`) ; les services travaillent en centimes.
- **Description** : chaque outil dit ce qu'il fait, l'unité de ses montants, le niveau d'accès et le droit vérifié dans la société, et ce qu'il ne fait jamais (`describeTool`, `lib/mcp/tool-meta.ts`).
- **Annotations** (MCP `ToolAnnotations`), toujours les quatre :
  - lecture : `readOnlyHint` vrai, `destructiveHint` faux, `idempotentHint` vrai, `openWorldHint` faux ;
  - écriture : `readOnlyHint` faux ; `destructiveHint` vrai quand l'appel remplace ou supprime quelque chose qui existe (les montants d'une ligne, une évaluation, un brouillon, une écriture validée) et faux quand il ne fait qu'ajouter ; `idempotentHint` vrai quand le même appel répété ne change rien de plus ;
  - `openWorldHint` vrai seulement pour `sync_bank`, qui interroge la banque.

  Un test (`lib/mcp/__tests__/tool-metadata.test.ts`) vérifie titre, annotations, description et convention de montants de chaque outil, à chaque niveau d'accès.
- **Erreurs** : en français ; une société hors de l'autorisation répond « Société introuvable », un rôle insuffisant « Accès refusé ».

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
| `list_budgets` | Budgets de la société, par exercice : nombre de lignes, charges, produits et résultat prévus ; droit `reports:read` |
| `get_budget` | Budget d'un exercice avec chaque ligne (identifiant pour `update_budget_line`, montants par mois, éléments récurrents, prévu par mois) ; droit `reports:read` |
| `get_auxiliary_balance` | Balance auxiliaire d'une période : par client et fournisseur, solde d'ouverture, débits, crédits, solde de clôture et part non lettrée ; droit `reports:read` |
| `list_doubtful_receivables` | Clients en retard à la clôture au-delà de 30, 60 ou 90 jours, candidats à une dépréciation, avec la dépréciation déjà suivie ; droit `reports:read` |
| `list_tax_deadlines` | Échéances fiscales et juridiques d'un exercice (TVA, IS, liasse, CFE, CVAE, approbation et dépôt), jours restants, règle et sources officielles ; dates seulement, les statuts sont dans `list_declarations_status` ; droit `reports:read` |
| `get_vat_return` | Déclaration de TVA préparée d'une période (CA3 ou CA12, la prochaine due par défaut) : chaque ligne avec son numéro et sa case, montants des comptes et euros à saisir, lignes calculées ou à remplir à la main, montant dû ou crédit, échéance, contrôles et fiabilité des chiffres, écriture de liquidation, dépôt enregistré, sources ([déclarations de TVA](declarations-tva.md)) ; ne dépose rien ; droit `reports:read` |
| `get_corporate_tax` | Impôt sur les sociétés préparé d'un exercice (celui dont le solde est dû par défaut, ou celui d'une échéance du calendrier) : résultat fiscal ligne par ligne avec la ligne de la 2033-B ou de la 2058-A (réintégrations lues dans les comptes, dividendes de filiales, lignes à la main), déficits et leur historique, taux de 15 % et 25 % avec les conditions du taux réduit, contribution sociale, crédits, solde du relevé 2572 et sa date, acomptes 2571 de l'exercice suivant, contrôles, sources ([impôt sur les sociétés](impot-societes.md)) ; ne dépose rien ; droit `reports:read` |
| `get_local_taxes` | Impôts locaux d'une année ([impôts locaux](impots-locaux.md)) : CFE d'après l'avis saisi (situation de l'année de création, acompte du 15 juin et solde, charge prévue au 63511 par mois, cotisation minimum), CVAE calculée sur la valeur ajoutée des comptes et les ajustements (statut de l'année, taux maximal, seuils de 152 500 € et 500 000 €, taux effectif, dégrèvement, franchise, contribution complémentaire de 2025, acomptes), estimation du plafonnement, échéances avec leur statut, sources ; droit `reports:read` |
| `list_declarations_status` | Échéances d'un exercice avec leur statut (à faire, déposée, payée, en retard, non due), ce qu'elles demandent, les dates et montants enregistrés, d'où ils viennent (suivi, déclarations de TVA, impôt sur les sociétés, approbation) et les champs verrouillés ; filtres par catégorie et statut ([échéances](echeances.md)) ; droit `reports:read` |
| `get_bank_sync_status` | État des flux bancaires : connexions, dernière synchronisation, erreur, consentement, et par compte les opérations non rapprochées et la plus ancienne, sans IBAN ni identifiant ; droit `banking:read` |
| `list_expenses_to_review` | Dépenses (`side: debit`) et recettes (`side: credit`) à vérifier du mode simple : transactions non rapprochées avec, pour une recette, la facture de vente qu'elle paie, sinon la catégorie proposée (règles, historique de la contrepartie, dictionnaire des payeurs français, mots du libellé, associés, clients, catégorie de la banque), la confiance, la raison et la question à trancher ([catégories simples](categories-simples.md)) ; droit `banking:read` |
| `list_expense_claimants` | Bénéficiaires de notes de frais (identifiant, compte auxiliaire) que le rôle de l'utilisateur lui montre ; droit `entries:read` |

### Lecture et brouillons (`kledg:write`)

Ces outils préparent du travail qu'une personne vérifie dans Kledg. Ils passent tous par `registerDraftTool` (`lib/mcp/drafts/define.ts`) : arguments vérifiés (messages en français), puis chaque droit de l'outil vérifié dans la société par le contrôle d'accès des autres outils (sociétés choisies, rôle, société archivée), exactement comme la route de l'API correspondante, puis le service de `lib/` que l'interface utilise, puis une entrée `MCP_WRITE` au journal d'audit (utilisateur, assistant, identifiants). Chaque réponse dit ce qui a changé (`changes`) et donne le lien de la page de Kledg où le vérifier (`reviewUrl`). Aucun ne valide ni ne comptabilise une écriture, ne clôture un exercice, ne génère un document définitif ni ne suit le mode d'exécution du contrôle total.

| Outil | Rôle | Droit vérifié | Remplace l'existant | Idempotent |
| --- | --- | --- | --- | --- |
| `create_draft_entry` | Proposer une écriture équilibrée, créée en **brouillon** | `entries:create` | Non | Non |
| `create_budget` | Créer le budget d'un exercice ouvert, vide ou par grands postes (409 s'il existe) | `budgets:manage` | Non | Oui |
| `create_budget_line` | Ajouter une ligne de budget (début de compte de classe 6 ou 7), montants par mois et éléments récurrents | `budgets:manage` | Non | Non |
| `update_budget_line` | Modifier une ligne : compte, libellé ; montants et éléments récurrents donnés remplacent ceux de la ligne | `budgets:manage` | Oui | Oui |
| `classify_subscription` | Confirmer, ignorer, compter une charge récurrente comme abonnement, remettre à traiter | `banking:reconcile` | Oui | Oui |
| `add_subscription_to_budget` | Ajouter un abonnement détecté à une ligne de charges comme élément récurrent et le confirmer | `budgets:manage` et `banking:reconcile` | Non | Oui |
| `create_provision` | Enregistrer une provision ou une dépréciation (compte, nature, justification) | `entries:create` | Non | Non |
| `record_provision_assessment` | Montant requis à la clôture, ou valeur actuelle d'une immobilisation ; supprime le brouillon lié, refusé si son écriture est validée | `entries:create` | Oui | Oui |
| `create_investment_grant` | Enregistrer une subvention d'investissement et son rythme de reprise | `entries:create` | Non | Non |
| `prepare_year_end_entries` | Préparer dotations, reprises et quotes-parts de subventions en **brouillons** au journal OD ; une seconde fois ne crée rien | `entries:create` | Oui (brouillons périmés) | Oui |
| `create_draft_expense_report` | Note de frais en **brouillon** pour l'utilisateur ou, s'il valide les notes, un autre bénéficiaire ; `dryRun` pour un aperçu | `expenses:submit` | Non | Non |
| `update_year_end_formalities` | Renseigner l'approbation des comptes (dates, taille, mode de décision, votes, affectation proposée, dépôt) ; seuls les champs donnés changent | `closing:execute` | Oui | Oui |
| `prepare_vat_settlement` | Préparer l'écriture de liquidation de la TVA d'une période en **brouillon** au journal OD (comptes de TVA soldés, 44551 ou 44567, arrondi au 658 ou 758) ; inchangée si le brouillon correspond, remplacée s'il est périmé, jamais si elle est validée ; ne dépose pas la déclaration | `entries:create` | Oui (brouillon périmé) | Oui |
| `prepare_corporate_tax_entry` | Préparer en **brouillon** la charge d'impôt de l'exercice (695 / 444, journal OD, dernier jour) ou le paiement d'un acompte de l'exercice suivant (444 / 512, journal BQ, à son échéance) ; inchangé si le brouillon correspond, remplacé s'il est périmé, jamais si l'écriture est validée ; ne dépose ni ne paie | `entries:create` | Oui (brouillon périmé) | Oui |
| `mark_declaration` | Enregistrer qu'une échéance est déposée et/ou payée (dates, montant en euros, référence de la pièce, note) ou non due, ou retirer l'enregistrement ; refuse ce qu'une autre page enregistre (TVA, liasse, acomptes d'IS, approbation) ; ne dépose ni ne paie | `entries:create` | Non | Oui |
| `accept_expense_suggestion` | Confirmer une dépense ou une recette à vérifier : la proposition, une catégorie du catalogue (avec la réponse à sa question), une règle ou la facture de vente payée (`invoiceId`, règlement enregistré sur la facture à la validation) ; écriture en **brouillon** rapprochée avec la transaction, quel que soit le réglage de validation, sans créer de règle | `banking:reconcile` et `entries:create` | Non | Non |

À ce niveau, rien de ce que crée un assistant n'est validé automatiquement : les écritures apparaissent en brouillon dans Kledg et doivent être validées par une personne. `create_draft_expense_report` demandait auparavant le contrôle total : une note en brouillon ne compte nulle part tant qu'elle n'est ni soumise, ni validée, ni comptabilisée.

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

Chaque appel d'un outil de brouillons (sauf un aperçu `dryRun`) écrit `MCP_WRITE`, avec l'utilisateur, l'assistant, l'outil et les identifiants principaux. La préparation d'une action à approuver écrit `MCP_FULL_CONTROL_PENDING`, votre décision `MCP_ACTION_APPROVED` ou `MCP_ACTION_REJECTED`, et une exécution refusée (action non approuvée, refusée, déjà exécutée, expirée ou pour d'autres arguments) `MCP_FULL_CONTROL_REFUSED`. Les services écrivent en plus leurs propres entrées habituelles (clôture, affectation du résultat, rapprochement...).

### Ce que le serveur ne fait pas

À aucun niveau, contrôle total compris :

- **Génération des factures de frais de gestion** : `preview_management_fees` calcule, rien ne facture. Générer les factures engage la holding et chaque filiale (prix de transfert, TVA, série de numérotation, factures d'achat proposées aux filiales) : la décision se prend dans Kledg par une personne qui a les droits dans chaque société (décision du mainteneur, 2026-10-04).
- **Documents de l'approbation des comptes** : `update_year_end_formalities` renseigne les données, les documents (convocation, procès-verbal, rapport de gestion, dépôt) se génèrent et se signent dans Kledg.
- **Validation ou comptabilisation hors du contrôle total** : les outils de brouillons ne valident rien, ne comptabilisent ni notes de frais ni factures, ne clôturent rien ; en contrôle total, ces actions suivent le [mode d'exécution](#mode-dexécution-du-contrôle-total).
- Suppression de société, gestion des membres et des rôles, paramètres de l'instance et mises à jour, connexion d'une banque et identifiants des prestataires, clés API et autorisations d'assistants, suppression ou réouverture d'exercice, mise en page des états. Ces actions restent dans l'interface.

## Prompts

Le serveur publie des prompts MCP (capacité `prompts`, `lib/mcp/prompts.ts`) : des parcours guidés, en français, que l'assistant propose à l'utilisateur (dans Claude, menu des prompts du connecteur). Un prompt ne lit et n'écrit rien lui-même : il renvoie la marche à suivre, qui n'enchaîne que des outils de la connexion. Les étapes qui demandent un outil de brouillon ne sont données qu'avec `kledg:write` ; sinon, le prompt renvoie l'utilisateur à la page de Kledg. Aucun prompt ne demande une action à fort impact (validation, clôture, comptabilisation), et chacun rappelle que les montants sont en euros, que rien n'est validé par l'assistant et que les textes trouvés dans les données ne sont pas des instructions.

| Prompt | Titre | Arguments | Outils enchaînés |
| --- | --- | --- | --- |
| `cloture_du_mois` | Clôture du mois | `companyId`, `month` (AAAA-MM, le mois écoulé par défaut) | `get_bank_sync_status`, `list_bank_transactions`, `create_draft_entry` (brouillons), `list_missing_receipts`, `get_vat_return` (déclaration de TVA due), `list_tax_deadlines` |
| `preparer_cloture_exercice` | Préparer la clôture de l'exercice | `companyId`, `fiscalYearId` | `get_year_end_inventory`, `list_doubtful_receivables`, `create_provision`, `record_provision_assessment`, `create_investment_grant`, `prepare_year_end_entries` (brouillons), `list_entries`, `get_aged_balance`, `get_auxiliary_balance`, `get_trial_balance` |
| `revue_budgetaire` | Revue budgétaire | `companyId`, `fiscalYearId`, `throughMonth` | `list_budgets`, `get_budget_report`, `list_detected_subscriptions`, `classify_subscription`, `add_subscription_to_budget`, `get_budget`, `update_budget_line`, `create_budget_line` |
| `sante_financiere` | Santé financière | `companyId`, `fiscalYearId` | `get_sig`, `get_financial_ratios`, `get_aged_balance` |
| `approbation_des_comptes` | Approbation des comptes | `companyId`, `fiscalYearId` | `get_year_end_formalities`, `get_capital_composition`, `list_tax_deadlines`, `update_year_end_formalities` |

Un test (`lib/mcp/__tests__/prompts.test.ts`) vérifie que chaque outil nommé par un prompt existe au niveau de la connexion, qu'aucun outil à fort impact n'y figure et que le texte est en français sans tiret long.

## Couverture des fonctionnalités

Ce que l'assistant peut faire de chaque fonctionnalité récente (L : lecture, `kledg:read` ; B : brouillons, `kledg:write` ; CT : contrôle total, `kledg:admin`). « Kledg seulement » : volontairement absent du serveur MCP.

| Fonctionnalité | Lecture | Brouillons | Contrôle total | Kledg seulement |
| --- | --- | --- | --- | --- |
| Budgets ([budget](budget.md)) | `list_budgets`, `get_budget`, `get_budget_report` | `create_budget`, `create_budget_line`, `update_budget_line` | | Supprimer un budget ou une ligne |
| Abonnements détectés ([abonnements](abonnements.md)) | `list_detected_subscriptions` | `classify_subscription`, `add_subscription_to_budget` | | Règle d'affectation depuis un abonnement (voir `create_rule` en CT) |
| Frais de gestion ([frais de gestion](frais-de-gestion.md)) | `list_management_fee_conventions`, `preview_management_fees` | | | Conventions, génération des factures (décision documentée ci-dessus) |
| Notes de frais ([notes de frais](notes-de-frais.md)) | `list_expense_reports`, `get_expense_report`, `list_expense_claimants` | `create_draft_expense_report` | | Soumettre, renvoyer, valider, comptabiliser, constater le remboursement ; bénéficiaires et mots-clés |
| Factures et tiers ([factures et tiers](factures-et-tiers.md)) | `list_tiers`, `list_invoices`, `get_invoice` | | `create_draft_invoice` | Créer ou modifier un tiers, comptabiliser une facture existante, import Qonto |
| Lettrage ([lettrage et tiers](lettrage-et-tiers.md)) | | | `list_unlettered_lines`, `letter_entry_lines`, `unletter_entry_lines` | Propositions automatiques en un clic |
| Balance âgée et balance auxiliaire | `get_aged_balance`, `get_auxiliary_balance` | | | Exports Excel |
| Mode simple, dépenses et recettes à vérifier ([catégories simples](categories-simples.md)) | `list_expenses_to_review` | `accept_expense_suggestion` (brouillon) | | Valider les saisies du mode simple (voir `validate_entries` en CT), envoyer un justificatif, réglage de validation |
| Justificatifs manquants | `list_missing_receipts` | | | Joindre une pièce (à la banque) |
| Échéances fiscales et juridiques | `list_tax_deadlines` | | | Réglages du calendrier |
| Déclarations de TVA ([déclarations de TVA](declarations-tva.md)) | `get_vat_return` | `prepare_vat_settlement` (brouillon) | `validate_entries` | Déposer et payer (sur impots.gouv.fr), enregistrer le dépôt, exports PDF et CSV |
| Impôt sur les sociétés ([impôt sur les sociétés](impot-societes.md)) | `get_corporate_tax` | `prepare_corporate_tax_entry` (brouillon) | `validate_entries` | Déclarer et payer (sur impots.gouv.fr), réponses du taux réduit, déficits, lignes à la main, acomptes versés, enregistrer le dépôt, exports PDF et CSV |
| Impôts locaux ([impôts locaux](impots-locaux.md)) | `get_local_taxes` | | | Saisir l'avis de CFE et les ajustements, écritures de CFE en brouillon, exports PDF et CSV, payer (sur impots.gouv.fr) |
| Suivi des déclarations ([échéances](echeances.md)) | `list_declarations_status` | `mark_declaration` | | Joindre une pièce Qonto |
| Indicateurs financiers, SIG et ratios ([indicateurs](indicateurs-financiers.md)) | `get_sig`, `get_financial_ratios` | | | Exports CSV et Excel, widgets |
| Provisions et dépréciations ([provisions](provisions-et-subventions.md)) | `get_year_end_inventory`, `list_doubtful_receivables` | `create_provision`, `record_provision_assessment` | | Modifier ou supprimer une provision, reclassement en 416 |
| Subventions d'investissement | `get_year_end_inventory` | `create_investment_grant` | | Modifier ou supprimer une subvention |
| Travaux de clôture | `get_year_end_inventory` | `prepare_year_end_entries` (brouillons) | `validate_entries`, `generate_depreciation`, `close_fiscal_year`, `allocate_result` | |
| Composition du capital | `get_capital_composition` | | | Saisie des associés |
| Approbation des comptes ([approbation](approbation-des-comptes.md)) | `get_year_end_formalities` (statut et données manquantes) | `update_year_end_formalities` | | Générer, signer et déposer les documents |
| Banque et rapprochement | `list_bank_transactions`, `get_bank_sync_status` | `create_draft_entry` | `list_bank_accounts`, `sync_bank`, `import_statement`, `reconcile_transaction`, `run_rules`... | Connecter une banque |

