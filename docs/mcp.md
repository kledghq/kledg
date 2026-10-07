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

Créer une société (`create_company`) demande une connexion sur **Toutes mes sociétés** : la nouvelle société en fait partie dès sa création. Une connexion limitée à des sociétés choisies ne peut pas en créer, car un assistant n'élargit jamais une liste que vous avez choisie ; créez la société dans Kledg, puis ajoutez-la à la liste de la connexion si besoin.

Le choix est toujours enregistré (page d'autorisation, création de la clé) : une connexion sans choix enregistré n'accède à aucune société. Supprimer une clé supprime aussi son choix de sociétés. Une société supprimée disparaît des listes. Le choix ne donne jamais plus de droits que les vôtres : vos rôles dans chaque société s'appliquent toujours.

## Révoquer un assistant

Le bouton **Révoquer** d'un assistant autorisé supprime, pour votre compte :

- votre autorisation pour cet assistant et son choix de sociétés ;
- ses jetons de rafraîchissement (et les jetons d'accès enregistrés) : l'assistant ne peut plus obtenir de nouveau jeton ;
- l'accès des jetons déjà émis : un jeton d'accès encore valide est refusé par `/api/mcp` dès la requête suivante (réponse 401 `invalid_token`), puisque l'autorisation n'existe plus.

Le nettoyage est fait par la base de données (déclencheurs sur la table des autorisations), quel que soit le chemin de la révocation. Les autres utilisateurs du même assistant ne sont pas concernés. Pour rétablir l'accès, reconnectez l'assistant : la page d'autorisation s'affiche de nouveau.

## Proposer avec l'IA

Sur les objets où un assistant aide (une transaction à rapprocher, un brouillon d'écriture, une facture, un justificatif manquant, une dépense ou une recette à classer en mode simple, une déclaration de TVA, ce qui bloque la clôture d'un exercice), le bouton **Proposer avec l'IA** ouvre votre assistant dans un nouvel onglet avec une demande préparée, par exemple : « Avec Kledg (société « Atelier Lumen », id …), propose l'écriture pour la transaction … du 29/09/2026, « PRLV SEPA FREE PRO », débit de 47,99 €. Lis-la avec get_transaction_details… ». La demande nomme la société et l'objet par leurs identifiants et les outils à appeler ; Kledg n'appelle aucun modèle : c'est votre assistant qui lit les données, avec l'accès que vous lui avez donné. Claude préremplit le champ sans l'envoyer ; ChatGPT peut envoyer la demande dès l'ouverture. Pour un justificatif manquant, la demande donne le fournisseur reconnu et demande à l'assistant de chercher la facture dans vos outils de messagerie et de fichiers s'il y a accès, puis de la joindre avec `upload_receipt` (compte Qonto) ou de vous la donner, sinon d'indiquer la page des factures du fournisseur ([Justificatifs](lettrage-et-tiers.md#où-trouver-la-facture)) ; Kledg ne lit ni vos mails ni vos fichiers.

- **Quand il s'affiche** : seulement si vous avez connecté un assistant qui atteint la société (`lib/ai-access/company-assistants.service.ts`) : un assistant autorisé (consentement toujours présent, client non désactivé) ou une clé API active et non expirée, dont l'accès couvre toutes vos sociétés ou celle-ci. Sans assistant, pas de bouton.
- **Quelle application** : Claude (`https://claude.ai/new?q=`) ou ChatGPT (`https://chatgpt.com/?q=`) pour un assistant reconnu par son identifiant vérifié ; la demande est aussi copiée dans le presse-papiers, au cas où le champ resterait vide. Pour une clé API, Claude Code ou un client non vérifié, la demande est copiée. Avec plusieurs assistants, la flèche à côté du bouton permet de choisir ; le dernier choix est retenu pour votre compte dans ce navigateur.
- **Données** : la demande ne contient que des identifiants, des dates, des montants et des libellés cités entre « » (sans guillemets, sauts de ligne ni caractères de contrôle, tronqués) : un libellé bancaire ne peut pas y ajouter d'instruction. Jamais de secret. Les modèles sont dans `lib/ai-assist/prompts.ts`, testés avec les outils qu'ils nomment.

## Outils

### Conventions communes

- **Montants** : tout montant envoyé à un outil ou renvoyé par lui est en **euros**, nombre décimal à deux décimales au plus (`12.5` pour 12,50 €), jamais en centimes. Un montant à trois décimales est refusé avec un message en français. Les taux sont en pour cent (`20` pour 20 %), les ratios en fractions (`0.25` pour 25 %), les dates au format `AAAA-MM-JJ`, les mois `AAAA-MM`. Les outils convertissent à l'entrée et à la sortie (`lib/utils/money.ts`) ; les services travaillent en centimes.
- **Description** : chaque outil dit ce qu'il fait, l'unité de ses montants, le niveau d'accès et le droit vérifié dans la société, et ce qu'il ne fait jamais (`describeTool`, `lib/mcp/tool-meta.ts`).
- **Annotations** (MCP `ToolAnnotations`), toujours les quatre :
  - lecture : `readOnlyHint` vrai, `destructiveHint` faux, `idempotentHint` vrai, `openWorldHint` faux ;
  - écriture : `readOnlyHint` faux ; `destructiveHint` vrai quand l'appel remplace ou supprime quelque chose qui existe (les montants d'une ligne, une évaluation, un brouillon, une écriture validée) et faux quand il ne fait qu'ajouter ; `idempotentHint` vrai quand le même appel répété ne change rien de plus ;
  - `openWorldHint` vrai seulement pour les outils qui appellent un tiers : une banque (`sync_bank`, `sync_bank_data`, `upload_receipt`, `import_qonto_invoices`, `get_qonto_statements`, `list_qonto_receipts` et `get_file`) ou l'annuaire des entreprises (`lookup_siren`).

  Un test (`lib/mcp/__tests__/tool-metadata.test.ts`) vérifie titre, annotations, description et convention de montants de chaque outil, à chaque niveau d'accès.
- **Fichiers** : `export_report` et `get_file` renvoient le fichier dans le résultat de l'outil, en ressource intégrée MCP (`type: "resource"`, `blob` en base64, `mimeType`, nom du fichier dans `_meta.fileName`), après un bloc texte JSON (nom, type, taille). Le fichier est produit ou lu par le même service que la route de téléchargement, après les mêmes contrôles. Kledg ne crée jamais de lien de téléchargement pour un assistant, ni lien public ni jeton dans une URL : l'`uri` (`kledg://...`) nomme le fichier sans pouvoir être ouverte, et les liens signés de Qonto ne sont jamais renvoyés. Au-delà de 5 Mo, l'outil refuse en français et l'utilisateur télécharge le fichier dans Kledg (`lib/mcp/file-result.ts`).
- **Erreurs** : en français ; une société hors de l'autorisation répond « Société introuvable », un rôle insuffisant « Accès refusé ».

### Lecture seule (`kledg:read`)

| Outil | Rôle |
| --- | --- |
| `list_companies` | Sociétés accessibles, régimes fiscaux, exercice en cours ; les sociétés archivées avec `includeArchived` |
| `list_fiscal_years` | Exercices d'une société |
| `list_journals` | Journaux (AC, VE, BQ, OD, AN...) |
| `search_accounts` | Recherche dans le plan comptable |
| `get_trial_balance` | Balance générale entre deux dates |
| `get_balance_sheet` | Bilan d'un exercice |
| `get_income_statement` | Compte de résultat d'un exercice |
| `list_entries` | Écritures (avec leur identifiant), filtrables par date, journal, compte, statut |
| `list_bank_transactions` | Transactions bancaires, par défaut celles à rapprocher |
| `get_aged_balance` | Balance âgée à une date : créances clients (411) et dettes fournisseurs (401) non lettrées, par tiers et par ancienneté de l'échéance ([lettrage et tiers](lettrage-et-tiers.md)) ; droit `reports:read` |
| `list_missing_receipts` | Transactions bancaires sans justificatif, au-dessus d'un seuil, par exercice ou période et par compte, avec le fournisseur reconnu et la page officielle de ses factures quand elle est connue ([Justificatifs](lettrage-et-tiers.md#où-trouver-la-facture)) ; droit `banking:read` |
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
| `get_annexe` | Annexe des comptes annuels d'un exercice selon la catégorie de taille (micro : informations à la suite du bilan ; petite au régime simplifié ; petite ; moyenne et grande) : notes avec leur source PCG et leurs tableaux, informations manquantes, avertissements, registre des méthodes comptables et changements de l'exercice ([annexe](annexe-et-2054.md)) ; droit `reports:read` |
| `get_fixed_asset_movements` | Immobilisations et amortissements d'un exercice ligne par ligne des formulaires 2054-SD, 2055-SD et 2033-C-SD avec leurs cases, totaux par rubrique, contrôles avec le bilan et le registre des immobilisations ; droit `reports:read` |
| `list_management_fee_conventions` | Conventions de frais de gestion d'une holding avec ses filiales : prix, marge, clé de répartition, TVA ([frais de gestion](frais-de-gestion.md)) ; droit `reports:read` |
| `preview_management_fees` | Calcul des frais de gestion d'une période, montant HT, TVA et TTC de chaque filiale, sans rien facturer ; droit `reports:read` dans la holding et dans chaque filiale |
| `get_group_view` | Vue combinée d'une holding et de ses filiales pour un exercice : chiffre d'affaires, EBE, résultat, trésorerie, capitaux propres, endettement et total du bilan par société, agrégés et après élimination des flux intragroupe (frais de gestion, factures, comptes courants, prêts, dividendes), écarts, trésorerie par mois ; vue indicative, pas des comptes consolidés ([vue groupe](vue-groupe.md)) ; droit `reports:read` dans la holding et dans chaque filiale lue, les filiales hors de l'autorisation de l'assistant sont comptées, ni lues ni nommées |
| `get_participations` | Filiales et participations de la holding (2059-G-SD, 2033-G-SD) : catégorie, détention, valeur brute et nette des titres, capital, capitaux propres, quote-part, chiffre d'affaires, résultat, prêts et avances, dividendes ; mêmes droits |
| `get_group_companies` | Sociétés du groupe d'une holding : forme juridique, SIREN, détention par la holding, dirigeants de la dernière approbation des comptes, chiffres clés de l'exercice qui correspond à celui de la holding ([espace groupe](vue-groupe.md)) ; mêmes droits |
| `get_group_indicators` | Indicateurs de chaque société du groupe, exercice N et N-1 (chiffre d'affaires, valeur ajoutée, EBE, résultats, CAF, BFR, trésorerie nette, dettes financières, capitaux propres, marges, endettement, DSO, DPO) et de l'agrégat du groupe, comptes additionnés à 100 %, flux intragroupe non éliminés ; mêmes droits |
| `get_group_evolution` | Produits, charges, résultat et trésorerie de chaque société du groupe et de leur somme, mois par mois sur l'exercice de la holding ; mêmes droits |
| `get_group_treasury` | Comptes bancaires des sociétés du groupe (IBAN masqué, dernier solde connu, devise), totaux par devise, trésorerie comptable par mois, comptes courants et prêts entre sociétés avec leurs écarts ; mêmes droits |
| `get_group_shareholders` | Associés des sociétés du groupe (personnes physiques, sociétés, autres personnes morales) avec leurs pourcentages direct, indirect par les sociétés du groupe et total, et dirigeants de chaque société ; noms seulement, ni photo ni coordonnées ; mêmes droits |
| `get_group_deadlines` | Échéances et statuts du suivi des déclarations de chaque société du groupe (TVA, IS, CFE et CVAE, approbation et dépôt des comptes) et synthèse par nature ; lecture seule, le statut s'enregistre dans chaque société ; mêmes droits |
| `get_group_alerts` | Ce qui demande attention dans le groupe : déclarations en retard, transactions à rapprocher et écritures en brouillon de chaque société ; mêmes droits |
| `list_group_transactions` | Transactions bancaires de toutes les sociétés du groupe en une liste, des plus récentes aux plus anciennes, page par page (`nextCursor`), filtres société, texte, sens, rapprochement et période ; lecture seule ; mêmes droits |
| `get_group_ledger` | Grand livre combiné : chaque compte des sociétés du groupe avec le solde de chacune et le total (agrégation, pas consolidation), et les lignes d'un compte dans toutes les sociétés ; mêmes droits |
| `get_group_structure` | Organigramme du groupe : personnes et sociétés, détentions avec leur pourcentage et leur catégorie (filiale, participation), détention directe, indirecte et totale de la holding et de chaque associé dans chaque société, dirigeants ; une filiale hors de l'autorisation est « Société non accessible », sans nom, identifiant ni pourcentage ; mêmes droits |
| `simulate_tax_integration` | Impôt sur les sociétés de chaque société du groupe (tel que sa page le calcule), régime mère-fille entre elles, et simulation indicative d'intégration fiscale (CGI art. 223 A à 223 U) : conditions de chaque société, résultat d'ensemble et retraitements (quote-part de 1 % sur les dividendes du groupe, frais de gestion neutres, retraitements saisis en euros), déficits antérieurs, impôt du groupe face à la somme des impôts séparés, sources citées ; lecture seule, mêmes droits |
| `list_budgets` | Budgets de la société, par exercice : nombre de lignes, charges, produits et résultat prévus ; droit `reports:read` |
| `get_budget` | Budget d'un exercice avec chaque ligne (identifiant pour `update_budget_line`, montants par mois, éléments récurrents, prévu par mois) ; droit `reports:read` |
| `get_auxiliary_balance` | Balance auxiliaire d'une période : par client et fournisseur, solde d'ouverture, débits, crédits, solde de clôture et part non lettrée ; droit `reports:read` |
| `get_tiers_flows` | Flux d'un exercice avec les clients et les fournisseurs (diagramme de la page Tiers) : montant TTC facturé à chaque client et par chaque fournisseur, avoirs déduits, écritures validées seulement, hors règlements et à-nouveaux, total et part de chacun ; droit `reports:read` |
| `list_doubtful_receivables` | Clients en retard à la clôture au-delà de 30, 60 ou 90 jours, candidats à une dépréciation, avec la dépréciation déjà suivie ; droit `reports:read` |
| `list_tax_deadlines` | Échéances fiscales et juridiques d'un exercice (TVA, IS, liasse, CFE, CVAE, approbation et dépôt), jours restants, règle et sources officielles ; dates seulement, les statuts sont dans `list_declarations_status` ; droit `reports:read` |
| `get_cash_forecast` | Prévision de trésorerie sur 3, 6 ou 12 mois, par mois ou par semaine ([prévision de trésorerie](prevision-tresorerie.md)) : solde du jour (banques, sinon comptes 512), factures clients et fournisseurs ouvertes à leur échéance, échéances fiscales au montant connu, paiements récurrents, et en hypothèses le budget et le rythme récent ; chaque période avec le détail par composante, le solde le plus bas, le seuil d'alerte et le premier jour sous le seuil ; une projection, pas une garantie ; droits `reports:read` et `banking:read` |
| `get_vat_return` | Déclaration de TVA préparée d'une période (CA3 ou CA12, la prochaine due par défaut) : chaque ligne avec son numéro et sa case, montants des comptes et euros à saisir, lignes calculées ou à remplir à la main, montant dû ou crédit, échéance, contrôles et fiabilité des chiffres, écriture de liquidation, dépôt enregistré, sources ([déclarations de TVA](declarations-tva.md)) ; ne dépose rien ; droit `reports:read` |
| `get_corporate_tax` | Impôt sur les sociétés préparé d'un exercice (celui dont le solde est dû par défaut, ou celui d'une échéance du calendrier) : résultat fiscal ligne par ligne avec la ligne de la 2033-B ou de la 2058-A (réintégrations lues dans les comptes, dividendes de filiales, lignes à la main), déficits et leur historique, taux de 15 % et 25 % avec les conditions du taux réduit, contribution sociale, crédits, solde du relevé 2572 et sa date, acomptes 2571 de l'exercice suivant, contrôles, sources ([impôt sur les sociétés](impot-societes.md)) ; ne dépose rien ; droit `reports:read` |
| `simulate_remuneration` | Simulation indicative, jamais un conseil, de la rémunération et des dividendes du dirigeant associé d'une société à l'IS pour un exercice : résultat avant rémunération lu dans les comptes (à ce jour, projeté ou dernier exercice clos, 644 et 646 réintégrés) ou donné, statut d'après la forme juridique (assimilé salarié, gérant majoritaire non salarié), quatre scénarios côte à côte (tout en rémunération, tout en dividendes, mixte, optimum qui maximise le revenu net dans le bénéfice distribuable) avec coût pour la société, IS, réserve légale, cotisations approchées, prélèvements sociaux ou cotisations au-delà de 10 % du capital, impôt sur le revenu (PFU ou barème), net en poche, scénarios enregistrés, dividendes proposés à l'approbation, sources ([rémunération et dividendes](remuneration-dividendes.md)) ; droit `reports:read` |
| `get_vat_deduction_coefficient` | Coefficient de déduction de TVA d'une année ([organisme de formation](organisme-de-formation.md)) : recettes par compte (ouvrant droit à déduction, exonérées, à classer, exclues), coefficient de taxation arrondi par excès, coefficients provisoire et définitif, régularisation avant le 25 avril et sa ligne de déclaration ; droit `reports:read` |
| `get_training_report` | Bilan pédagogique et financier d'un exercice clos (cerfa 10443*17) : cadre C depuis les comptes et les origines affectées, cadre D, cadres saisis, contrôles de la notice, échéance ; droit `reports:read` |
| `get_payroll_tax` | Taxe sur les salaires d'une année : assujettissement et rapport d'après les recettes de l'année précédente, calcul de la 2502 depuis les bases saisies par salarié, franchise, décote, abattement, fréquence des relevés 2501, échéances ; droit `reports:read` |
| `get_local_taxes` | Impôts locaux d'une année ([impôts locaux](impots-locaux.md)) : CFE d'après l'avis saisi (situation de l'année de création, acompte du 15 juin et solde, charge prévue au 63511 par mois, cotisation minimum), CVAE calculée sur la valeur ajoutée des comptes et les ajustements (statut de l'année, taux maximal, seuils de 152 500 € et 500 000 €, taux effectif, dégrèvement, franchise, contribution complémentaire de 2025, acomptes), estimation du plafonnement, échéances avec leur statut, sources ; droit `reports:read` |
| `list_declarations_status` | Échéances d'un exercice avec leur statut (à faire, déposée, payée, en retard, non due), ce qu'elles demandent, les dates et montants enregistrés, d'où ils viennent (suivi, déclarations de TVA, impôt sur les sociétés, approbation) et les champs verrouillés ; filtres par catégorie et statut ([échéances](echeances.md)) ; droit `reports:read` |
| `get_bank_sync_status` | État des flux bancaires : connexions, dernière synchronisation, erreur, consentement, et par compte les opérations non rapprochées et la plus ancienne, sans IBAN ni identifiant ; droit `banking:read` |
| `list_expenses_to_review` | Dépenses (`side: debit`) et recettes (`side: credit`) à vérifier du mode simple : transactions non rapprochées avec, pour une recette, la facture de vente qu'elle paie, sinon la catégorie proposée (règles, historique de la contrepartie, dictionnaire des payeurs français, mots du libellé, associés, clients, catégorie de la banque), la confiance, la raison et la question à trancher ([catégories simples](categories-simples.md)) ; droit `banking:read` |
| `list_expense_claimants` | Bénéficiaires de notes de frais (identifiant, compte auxiliaire) que le rôle de l'utilisateur lui montre ; droit `entries:read` |
| `get_entry` | Une écriture avec son journal, sa date, son numéro, son statut, sa pièce et chaque ligne (compte, libellé, débit, crédit, lettrage, compte auxiliaire) ; droit `entries:read` |
| `get_ledger_report` | Grand livre (par compte, solde d'ouverture, lignes avec solde progressif, solde de clôture ; filtre par début de compte) ou journal (écritures par journal avec totaux) d'une période, 1 000 lignes au plus ; droit `reports:read` |
| `list_fixed_assets` | Immobilisations avec comptes, valeurs, plan d'amortissement et totaux ; une immobilisation avec ses amortissements, l'état de ses dotations par exercice, les écritures auxquelles lier un amortissement ; droit `entries:read` |
| `list_expense_category_rules` | Règles de mots-clés qui donnent la catégorie (et le compte) des lignes de notes de frais ; droit `entries:read` |
| `get_company_settings` | Une section des paramètres de la société : fiche, établissements, membres, personnes, une personne (toutes ses données et ses liens, RGPD art. 15 et 20), associés, délai de paiement, options de TVA, mode simple, calendrier des échéances, numérotation des factures (format, prochains numéros, création dans Qonto), prévision de trésorerie (seuil, horizon, composantes), régimes fiscaux, adresses ; logos et photos remplacés par leur présence ; droit `settings:read` |
| `get_statement_layout` | Mise en page du bilan ou du compte de résultat (lignes, comptes, sens, ordre), une ligne, l'historique d'une ligne du bilan, les modèles du bilan ; droit `settings:read` |
| `get_transaction_details` | Ce qu'il faut pour traiter une transaction bancaire : ligne de banque, exercices, contreparties proposées, règles qui la reconnaissent, règle qu'elle suggère ; droit `banking:read` |
| `simulate_rule` | L'écriture qu'une règle d'affectation (enregistrée ou en cours d'écriture) passerait pour une transaction d'exemple, sans rien écrire ; droit `banking:read` |
| `list_rule_templates` | Bibliothèque de règles ([bibliothèque de règles](bibliotheque-de-regles.md)) : modèles de règles d'affectation (conditions, lignes, traitement de la TVA et sa raison, sources officielles), comptes rapprochés du plan de la société, modèles déjà ajoutés et règles proches, et suggestions classées par le nombre de transactions des 12 derniers mois que le modèle reconnaîtrait et qu'aucune règle ne reconnaît ; un modèle avec `templateId` ; droit `banking:read` |
| `export_report` | Fichier d'un état, comme son bouton de téléchargement (même service, mêmes contrôles) : bilan et compte de résultat (PDF, Excel), annexe (PDF, Markdown), formulaires 2054, 2055 et 2033-C, impôt sur les sociétés, TVA, impôts locaux, rémunération (PDF, CSV), indicateurs financiers (CSV, Excel), balance âgée, balance auxiliaire et journal (Excel), prévision de trésorerie (CSV, droit `banking:read` en plus), vue de groupe (CSV, Excel) ; 5 Mo au plus ; droit `reports:export` (et `reports:read` dans chaque filiale lue pour le groupe) |
| `get_qonto_statements` | Relevés mensuels des comptes Qonto (liste filtrée par compte, IBAN et période, ou un relevé), sans les liens de fichier de Qonto ; droit `banking:read` |
| `list_qonto_receipts` | Justificatifs que Qonto détient pour une transaction de la société ; droit `banking:read` |
| `get_file` | Un document en ressource intégrée : justificatif d'une transaction, PDF d'une facture importée de Qonto, PDF d'un relevé Qonto ; 5 Mo au plus ; droit `banking:read` (justificatif, relevé) ou `entries:read` (facture) |
| `lookup_siren` | Une entreprise de l'annuaire public (recherche-entreprises.api.gouv.fr) à partir de son SIREN, pour préparer `create_company` ; selon la politique de création des sociétés de l'instance (administrateurs de l'instance par défaut) |

`get_bank_sync_status` donne aussi les intégrations bancaires (identifiant pour `sync_bank_data`, statut, fonctions actives, sans identifiant ni donnée du prestataire) et `list_management_fee_conventions` les périodes facturées d'une convention (vue `billings`) et les filiales candidates (vue `subsidiaries`).

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
| `manage_accounting_methods` | Registre des méthodes comptables (créer, modifier, supprimer) ; une méthode de référence le reste (PCG art. 121-5) | `entries:create`, `entries:delete` pour supprimer | Oui | Non |
| `manage_accounting_changes` | Changements de méthode, de réglementation ou d'estimation et corrections d'erreurs (PCG art. 122-1 à 122-6) ; `prepare_entry` prépare l'écriture de rattrapage en **brouillon** (110 / 119 ou 678 / 778) | `entries:create`, `entries:delete` pour supprimer | Oui (brouillon périmé) | Non |
| `update_annexe_notes` | Renseigner l'annexe (engagements, événements postérieurs, dirigeants, échéances, effectif, crédits d'impôt) ; seuls les champs donnés changent | `closing:execute` | Oui | Oui |
| `prepare_vat_settlement` | Préparer l'écriture de liquidation de la TVA d'une période en **brouillon** au journal OD (comptes de TVA soldés, 44551 ou 44567, arrondi au 658 ou 758) ; inchangée si le brouillon correspond, remplacée s'il est périmé, jamais si elle est validée ; ne dépose pas la déclaration | `entries:create` | Oui (brouillon périmé) | Oui |
| `prepare_corporate_tax_entry` | Préparer en **brouillon** la charge d'impôt de l'exercice (695 / 444, journal OD, dernier jour) ou le paiement d'un acompte de l'exercice suivant (444 / 512, journal BQ, à son échéance) ; inchangé si le brouillon correspond, remplacé s'il est périmé, jamais si l'écriture est validée ; ne dépose ni ne paie | `entries:create` | Oui (brouillon périmé) | Oui |
| `save_remuneration_scenario` | Enregistrer un scénario nommé du simulateur de rémunération et dividendes d'un exercice (les hypothèses non données viennent des comptes), le supprimer, ou proposer ses dividendes dans l'approbation des comptes de son exercice ; ne comptabilise pas l'affectation et ne vote rien | `closing:execute` | Oui | Oui |
| `mark_declaration` | Enregistrer qu'une échéance est déposée et/ou payée (dates, montant en euros, référence de la pièce, note) ou non due, ou retirer l'enregistrement ; refuse ce qu'une autre page enregistre (TVA, liasse, acomptes d'IS, approbation) ; ne dépose ni ne paie | `entries:create` | Non | Oui |
| `accept_expense_suggestion` | Confirmer une dépense ou une recette à vérifier : la proposition, une catégorie du catalogue (avec la réponse à sa question), une règle ou la facture de vente payée (`invoiceId`, règlement enregistré sur la facture à la validation) ; écriture en **brouillon** rapprochée avec la transaction, quel que soit le réglage de validation, sans créer de règle | `banking:reconcile` et `entries:create` | Non | Non |
| `accept_all_expense_suggestions` | « Tout confirmer » du mode simple : les dépenses sûres (confiance haute, sans question) parmi celles données, chacune en **brouillon** rapproché ; les autres reviennent avec leur raison | `banking:reconcile` et `entries:create` | Non | Oui |
| `manage_tiers` | Clients et fournisseurs : créer, modifier, rattacher les comptes auxiliaires déjà utilisés sur des lignes 40 et 41 | `entries:create` (créer, rattacher), `entries:update` (modifier) | Oui (modifier) | Non |
| `duplicate_entry` | Copier une écriture en **brouillon** | `entries:create` | Non | Non |
| `update_draft_invoice` | Modifier une facture encore en brouillon (champs et lignes, ou seulement les comptes des lignes d'une facture importée) ; refusé une fois comptabilisée | `entries:update` | Oui | Oui |
| `update_provision`, `update_investment_grant` | Remplacer une provision ou une subvention ; figées dès qu'un mouvement est validé | `entries:create` | Oui | Oui |
| `update_draft_expense_report` | Remplacer la période, le libellé et les lignes d'une note de frais en brouillon (ou soumise, pour un valideur) ; Kledg recalcule montants et TVA | `expenses:submit` | Oui | Oui |
| `reclassify_doubtful_receivable` | Reclasser une créance de 411 en 416 à la clôture, en **brouillon** | `entries:create` | Non | Non |
| `save_vat_deduction_settings` | Régler le coefficient de déduction : assujetti partiel, estimation d'une première année, coefficient d'assujettissement, TVA supportée, traitement des comptes de produits | `entries:create` | Oui | Oui |
| `prepare_vat_coefficient_regularisation` | Préparer la régularisation du coefficient de déduction d'une année terminée en **brouillon** (44566 / 758 ou 658 / 44566) | `entries:create` | Oui (brouillon périmé) | Oui |
| `save_training_report` | Saisir les cadres du bilan pédagogique et financier d'un exercice (B, D, E, F, G) | `entries:create` | Oui | Oui |
| `save_training_origins` | Affecter un compte de produits ou un client à une ligne du cadre C du BPF | `entries:create` | Oui | Oui |
| `save_payroll_tax` | Saisir les bases annuelles par salarié et les réglages de la taxe sur les salaires d'une année | `entries:create` | Oui | Oui |
| `prepare_payroll_tax_entry` | Préparer l'écriture de taxe sur les salaires (6311 / 447) en **brouillon** | `entries:create` | Oui (brouillon périmé) | Oui |
| `save_local_taxes` | Saisir l'avis de CFE (total, acompte, date, note) et les ajustements de la valeur ajoutée de la CVAE d'une année | `entries:create` | Oui | Oui |
| `prepare_cfe_entry` | Préparer l'écriture de CFE (acompte ou solde, 63511 / 512 ou 63511 / 447) en **brouillon** ; inchangée si elle correspond, jamais si elle est validée | `entries:create` | Oui (brouillon périmé) | Oui |
| `save_corporate_tax_inputs` | Saisir ce que les comptes ne disent pas pour l'impôt sur les sociétés (capital libéré, 75 % de personnes physiques, déficits reportables, lignes à la main, acomptes versés) | `entries:create` | Oui | Oui |
| `record_tax_filing` | Enregistrer le dépôt d'une déclaration de TVA ou d'impôt sur les sociétés (date, montants), ou retirer cet enregistrement ; ne dépose ni ne paie | `entries:create` | Oui | Oui |
| `save_depreciation_record` | Enregistrer l'amortissement d'une période (un enregistrement, pas une écriture) ou le lier à une écriture | `entries:create` (enregistrer ; `entries:update` pour remplacer), `entries:update` (lier) | Oui | Oui |
| `prepare_opening_balances` | Soldes d'ouverture du premier exercice en **brouillon** au journal AN | `entries:create` | Non | Non |

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
| `create_draft_invoice` | Enregistrer une facture d'achat ou de vente en brouillon (lignes, plusieurs taux, totaux calculés par Kledg) et, sur demande, son écriture en brouillon dans l'exercice de sa date ; une vente suit la numérotation de la société (`numbering` : créée dans Qonto, numérotée par Kledg à la comptabilisation, ou facture déjà émise avec son numéro ; `qontoStatus` : finalisée ou brouillon dans Qonto) | `entries:create` | Oui |
| `manage_accounts` | Plan comptable : modifier un compte, supprimer un compte et ses sous-comptes, compléter le plan du PCG, semer le PCG, supprimer les comptes hors PCG | `ledger:manage` | Oui (suppressions) |
| `manage_journals` | Modifier ou supprimer un journal sans écriture, rétablir les journaux par défaut | `ledger:manage` | Oui (suppression) |
| `manage_fiscal_years` | Créer un exercice, changer les dates d'un exercice ouvert, supprimer un exercice ouvert sans écriture, clôturer les périodes jusqu'à un jour (PCG art. 1031-4) | `ledger:manage`, plus `closing:execute` pour la clôture des périodes | Oui (suppression, clôture des périodes) |
| `import_accounting_file` | Importer un FEC, un CSV ou un Excel d'écritures (base64, 5 Mo au plus) ; l'aperçu donne les exercices du FEC | `entries:create` et `ledger:manage` | Oui |
| `update_company_settings` | Fiche de la société, délai de paiement, options de TVA, mode simple, calendrier des échéances, numérotation des factures (et prochain numéro de la période, seulement à la hausse), seuil et réglages de la prévision de trésorerie | `settings:update` | Oui |
| `manage_company_records` | Établissements, personnes (création, rectification, effacement dans les limites de la conservation légale, RGPD art. 16 et 17), associés, régimes fiscaux, adresses | `settings:update` | Oui |
| `manage_statement_layout` | Mise en page du bilan et du compte de résultat (lignes, retour au PCG, historique, modèles) | `settings:update` | Oui |
| `manage_members` | Ajouter un membre, changer son rôle, le retirer ; administrateurs de l'instance seulement, comme la page | `members:manage` et administrateur de l'instance | Oui |
| `manage_bank_accounts` | Nom, compte 512 et synchronisation d'un compte bancaire, compte par défaut, comptes synchronisés d'une connexion, déconnexion d'une banque (identifiants supprimés, opérations gardées) | `banking:manage` | Oui (comptes synchronisés, déconnexion) |
| `bulk_reconcile` | Pointer des transactions sans écriture, annuler leur rapprochement, rapprochement automatique avec le journal BQ, appliquer une règle à une transaction | `banking:reconcile` | Oui (annulation, rapprochement automatique) |
| `delete_bank_transactions` | Supprimer des transactions bancaires | `banking:manage` | Oui |
| `duplicate_rule` | Copier une règle d'affectation (désactivée) | `ledger:manage` | Non |
| `add_rule_from_template` | Ajouter la règle d'un modèle de la bibliothèque, comptes rapprochés du plan de la société ; comptes manquants créés seulement avec `createMissingAccounts` ; refusé si la même règle existe, sauf `allowDuplicate` | `ledger:manage` | Non |
| `copy_rules_from_company` | Copier des règles d'une autre société de l'utilisateur, comptes rapprochés du plan ; copies inactives par défaut, règles déjà présentes ignorées | `ledger:manage` ici, `banking:read` dans la société source | Non |
| `sync_bank_data` | Synchroniser une intégration ou toutes, actualiser (synchronisation puis règles), copier les justificatifs de Qonto | `banking:reconcile` | Non |
| `upload_receipt` | Envoyer le justificatif d'une transaction Qonto (JPEG, PNG ou PDF en base64, 5 Mo au plus) ; l'aperçu donne la transaction et le fichier (nom, type, taille, SHA-256) | `banking:reconcile` | Oui |
| `manage_invoice` | Comptabiliser une facture (écriture en brouillon), annuler cette comptabilisation, supprimer un brouillon, enregistrer ou retirer un règlement, lettrer une facture réglée, reprendre la création dans Qonto d'une facture sans réponse de Qonto ; lignes de banque candidates (lecture) | `entries:create`, `entries:delete` ou `entries:update` selon l'action | Oui (sauf la lecture) |
| `import_qonto_invoices` | Importer les clients et les factures de Qonto (idempotent) | `entries:create` et `banking:read` | Oui |
| `delete_tiers` | Supprimer un client ou un fournisseur sans facture | `entries:delete` | Oui |
| `delete_budget_items` | Supprimer un budget ou une ligne | `budgets:manage` | Oui |
| `delete_year_end_items` | Supprimer une provision, une évaluation ou une subvention, avec leurs brouillons | `entries:delete` (provision, subvention), `entries:create` (évaluation) | Oui |
| `manage_expense_report` | Soumettre, renvoyer, valider, rouvrir une note de frais, la comptabiliser (brouillon) ou l'annuler, constater son remboursement, la supprimer ; paiements candidats (lecture) | `expenses:submit`, `expenses:validate`, `entries:create`, `entries:delete` ou `entries:update` selon l'action, comme les routes | Oui (sauf la lecture) |
| `manage_expense_settings` | Bénéficiaires des notes de frais et règles de mots-clés des catégories | `expenses:validate` | Oui (suppressions) |
| `manage_management_fee_convention` | Créer, remplacer ou supprimer une convention de frais de gestion (droits vérifiés dans chaque filiale) ; la génération des factures reste dans Kledg | `entries:create` | Oui |
| `auto_letter_account` | Lettrage automatique d'un compte de tiers (toutes les propositions) | `entries:update` | Oui |
| `manage_fixed_asset` | Modifier une immobilisation, la supprimer avec ses brouillons de dotation | `ledger:manage` | Oui (suppression) |
| `manage_depreciation_record` | Comptabiliser un amortissement en écriture **validée**, ou supprimer l'enregistrement | `entries:create` et `entries:validate` (comptabiliser), `entries:delete` (supprimer) | Oui |
| `create_company` | Créer une société comme l'assistant de création (identité, siège, premier exercice, régimes, capital et associés ; Kledg crée les membres, les journaux, l'exercice et le plan comptable), avec le crochet de l'instance ; seulement par une connexion autorisée sur toutes vos sociétés | politique de création des sociétés de l'instance (administrateurs de l'instance par défaut) | Oui |
| `archive_company` | Archiver une société : lecture seule, masquée des listes, livres conservés ; administrateurs de l'instance seulement, comme la page | administrateur de l'instance | Oui |
| `restore_company` | Restaurer une société archivée ; administrateurs de l'instance seulement | administrateur de l'instance | Oui |

Un outil qui regroupe plusieurs routes prend une `action` (ou une `section`, un `scope`) et vérifie, en plus de son droit, celui de la route de chaque action (`actions` de `fullControlTool` et `draftTool`, `permissionsOfAction` dans `lib/mcp/tool-meta.ts`) ; seules ses actions à fort impact (`highImpactActions`) suivent le mode d'exécution, les autres s'exécutent aussitôt. Les montants des corps de routes en centimes et les taux en points de base deviennent des euros et des pour cent pour l'assistant (`lib/mcp/euros.ts`), puis le schéma de la route vérifie le corps (messages en français).

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

- liée à votre compte, à la connexion (assistant ou clé API), à l'outil, à la société et aux arguments de l'aperçu : avec d'autres arguments, un autre outil ou une autre société elle est refusée ; présentée par une autre connexion ou un autre utilisateur, elle est introuvable. La création d'une société (`create_company`) n'a pas encore de société : son action n'est liée qu'à votre compte, à la connexion, à l'outil et aux arguments, et la page l'affiche comme « Nouvelle société » ;
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

### Vues interactives

Dans Claude et ChatGPT, les états financiers (`get_balance_sheet`, `get_income_statement`, `get_trial_balance`), les flux et la trésorerie (`get_tiers_flows`, `get_group_view`, `get_group_treasury`), les listes à traiter (`list_entries`, `list_bank_transactions`, `list_missing_receipts`), les factures et notes de frais (`get_invoice`, `get_expense_report`) et l'organigramme du groupe (`get_group_structure`) s'affichent en tableau, graphique ou fiche dans la conversation (extension MCP Apps). Leurs boutons passent par les mêmes outils : droits, approbation dans Kledg et journal d'audit inchangés. Les clients en texte seul reçoivent la même réponse qu'avant. Fonctionnement et sécurité : [mcp-views.md](mcp-views.md).

### Ce que le serveur ne fait pas

À aucun niveau, contrôle total compris :

- **Génération des factures de frais de gestion** : `preview_management_fees` calcule, rien ne facture. Générer les factures engage la holding et chaque filiale (prix de transfert, TVA, série de numérotation, factures d'achat proposées aux filiales) : la décision se prend dans Kledg par une personne qui a les droits dans chaque société (décision du mainteneur, 2026-10-04).
- **Documents de l'approbation des comptes** : `update_year_end_formalities` renseigne les données, les documents (convocation, procès-verbal, rapport de gestion, dépôt) se génèrent et se signent dans Kledg.
- **Validation ou comptabilisation hors du contrôle total** : les outils de brouillons ne valident rien, ne comptabilisent ni notes de frais ni factures, ne clôturent rien ; en contrôle total, ces actions suivent le [mode d'exécution](#mode-dexécution-du-contrôle-total).
- Suppression définitive d'une société (les livres sont conservés 10 ans : `archive_company` la met en lecture seule), paramètres de l'instance et mises à jour, comptes des utilisateurs de l'instance, connexion d'une banque et identifiants des prestataires, clés API et autorisations d'assistants, compte personnel (mot de passe, sessions, préférences). Ces actions restent dans l'interface ; la liste complète, avec la raison de chaque exclusion, est dans l'[inventaire de l'API](#inventaire-de-lapi).

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
| Budgets ([budget](budget.md)) | `list_budgets`, `get_budget`, `get_budget_report` | `create_budget`, `create_budget_line`, `update_budget_line` | `delete_budget_items` | |
| Abonnements détectés ([abonnements](abonnements.md)) | `list_detected_subscriptions` | `classify_subscription`, `add_subscription_to_budget` | `create_rule` (règle depuis un abonnement) | |
| Frais de gestion ([frais de gestion](frais-de-gestion.md)) | `list_management_fee_conventions` (conventions, périodes facturées, filiales), `preview_management_fees` | | `manage_management_fee_convention` | Génération des factures (décision documentée ci-dessus) |
| Notes de frais ([notes de frais](notes-de-frais.md)) | `list_expense_reports`, `get_expense_report`, `list_expense_claimants`, `list_expense_category_rules` | `create_draft_expense_report`, `update_draft_expense_report` | `manage_expense_report` (soumettre, renvoyer, valider, rouvrir, comptabiliser, rembourser, supprimer), `manage_expense_settings` (bénéficiaires et mots-clés) | |
| Factures et tiers ([factures et tiers](factures-et-tiers.md)) | `list_tiers`, `get_tiers_flows`, `list_invoices`, `get_invoice` | `manage_tiers`, `update_draft_invoice` | `create_draft_invoice`, `manage_invoice`, `delete_tiers`, `import_qonto_invoices` | |
| Lettrage ([lettrage et tiers](lettrage-et-tiers.md)) | | | `list_unlettered_lines`, `letter_entry_lines`, `unletter_entry_lines`, `auto_letter_account` | |
| Balance âgée et balance auxiliaire | `get_aged_balance`, `get_auxiliary_balance`, `export_report` (Excel) | | | |
| Mode simple, dépenses et recettes à vérifier ([catégories simples](categories-simples.md)) | `list_expenses_to_review` | `accept_expense_suggestion`, `accept_all_expense_suggestions` (brouillons) | `validate_entries`, `upload_receipt`, `update_company_settings` (réglage de validation) | |
| Justificatifs manquants | `list_missing_receipts` | | `upload_receipt` (Qonto) | |
| Échéances fiscales et juridiques | `list_tax_deadlines` | | `update_company_settings` (réglages du calendrier) | |
| Prévision de trésorerie ([prévision de trésorerie](prevision-tresorerie.md)) | `get_cash_forecast`, `get_company_settings` (seuil), `export_report` (CSV) | | `update_company_settings` (seuil, horizon, composantes) | |
| Déclarations de TVA ([déclarations de TVA](declarations-tva.md)) | `get_vat_return`, `export_report` (PDF, CSV) | `prepare_vat_settlement` (brouillon), `record_tax_filing` (dépôt enregistré) | `validate_entries` | Déposer et payer (sur impots.gouv.fr) |
| Impôt sur les sociétés ([impôt sur les sociétés](impot-societes.md)) | `get_corporate_tax`, `export_report` (PDF, CSV) | `prepare_corporate_tax_entry` (brouillon), `save_corporate_tax_inputs` (taux réduit, déficits, lignes à la main, acomptes versés), `record_tax_filing` | `validate_entries` | Déclarer et payer (sur impots.gouv.fr) |
| Rémunération et dividendes ([rémunération et dividendes](remuneration-dividendes.md)) | `simulate_remuneration`, `export_report` (PDF, CSV) | `save_remuneration_scenario` (enregistrer, supprimer, proposer les dividendes à l'approbation) | | |
| Organisme de formation, coefficient de déduction, taxe sur les salaires ([organisme de formation](organisme-de-formation.md)) | `get_vat_deduction_coefficient`, `get_training_report`, `get_payroll_tax`, `export_report` (BPF en CSV) | `save_vat_deduction_settings`, `save_training_report`, `save_training_origins`, `save_payroll_tax`, `prepare_vat_coefficient_regularisation`, `prepare_payroll_tax_entry` (brouillons) | | Déposer le BPF (sur Mon Activité Formation), déclarer et payer (sur impots.gouv.fr) |
| Impôts locaux ([impôts locaux](impots-locaux.md)) | `get_local_taxes`, `export_report` (PDF, CSV) | `save_local_taxes`, `prepare_cfe_entry` (brouillon) | | Payer (sur impots.gouv.fr) |
| Suivi des déclarations ([échéances](echeances.md)) | `list_declarations_status` | `mark_declaration` | | Joindre une pièce Qonto |
| Indicateurs financiers, SIG et ratios ([indicateurs](indicateurs-financiers.md)) | `get_sig`, `get_financial_ratios`, `export_report` (CSV, Excel) | | | Widgets |
| Provisions et dépréciations ([provisions](provisions-et-subventions.md)) | `get_year_end_inventory`, `list_doubtful_receivables` | `create_provision`, `update_provision`, `record_provision_assessment`, `reclassify_doubtful_receivable` (416, brouillon) | `delete_year_end_items` | |
| Subventions d'investissement | `get_year_end_inventory` | `create_investment_grant`, `update_investment_grant` | `delete_year_end_items` | |
| Travaux de clôture | `get_year_end_inventory` | `prepare_year_end_entries` (brouillons) | `validate_entries`, `generate_depreciation`, `close_fiscal_year`, `allocate_result` | |
| Composition du capital | `get_capital_composition`, `get_company_settings` | | `manage_company_records` (associés, personnes) | |
| Approbation des comptes ([approbation](approbation-des-comptes.md)) | `get_year_end_formalities` (statut et données manquantes) | `update_year_end_formalities` | | Générer, signer et déposer les documents |
| Annexe et formulaires 2054, 2055, 2033-C ([annexe](annexe-et-2054.md)) | `get_annexe`, `get_fixed_asset_movements`, `export_report` (annexe en PDF ou Markdown, formulaires en PDF ou CSV) | `manage_accounting_methods`, `manage_accounting_changes` (écritures en brouillon), `update_annexe_notes` | `validate_entries` | |
| Banque et rapprochement | `list_bank_transactions`, `get_bank_sync_status`, `get_transaction_details`, `simulate_rule`, `list_rule_templates`, `get_qonto_statements`, `list_qonto_receipts`, `get_file` | `create_draft_entry` | `list_bank_accounts`, `sync_bank`, `sync_bank_data`, `import_statement`, `reconcile_transaction`, `bulk_reconcile`, `run_rules`, `manage_bank_accounts`, `delete_bank_transactions`, `duplicate_rule`, `add_rule_from_template`, `copy_rules_from_company`... | Connecter une banque |
| Écritures, plan comptable, journaux, exercices | `list_entries`, `get_entry`, `get_ledger_report`, `search_accounts`, `list_journals`, `list_fiscal_years` | `create_draft_entry`, `duplicate_entry`, `prepare_opening_balances` | `update_draft_entry`, `validate_entries`, `reverse_entry`, `delete_draft_entry`, `create_account`, `manage_accounts`, `create_journal`, `manage_journals`, `manage_fiscal_years`, `import_accounting_file` | Exports Excel du journal |
| Immobilisations | `list_fixed_assets` | `save_depreciation_record` | `create_fixed_asset`, `manage_fixed_asset`, `manage_depreciation_record`, `generate_depreciation` | |
| Paramètres de la société, membres, mise en page des états | `get_company_settings`, `get_statement_layout` | | `update_company_settings`, `manage_company_records`, `manage_statement_layout`, `manage_members` (administrateurs de l'instance) | Suppression définitive de société |
| Création, archivage et restauration de société | `list_companies` (`includeArchived`), `lookup_siren` | | `create_company`, `archive_company`, `restore_company` | Suppression définitive |

## Inventaire de l'API

Règle du mainteneur : tout ce qu'un utilisateur peut faire dans Kledg se fait aussi par le serveur MCP, au bon niveau d'accès et avec les mêmes contrôles que l'interface et l'API. Chaque gestionnaire de `app/api` (méthode et chemin) correspond aux outils MCP qui font la même chose, ou à une exclusion écrite avec sa raison. La table vit dans le code (`lib/mcp/route-coverage.ts`) et un test (`lib/mcp/__tests__/route-coverage.test.ts`) échoue quand une route n'a ni outil ni exclusion, quand un outil nommé n'existe pas, quand une route qui modifie des données ne correspond à aucun outil d'écriture, ou quand cette page ne liste pas la route.

Niveaux : L, lecture (`kledg:read`) ; B, brouillons (`kledg:write`) ; CT, contrôle total (`kledg:admin`, avec le [mode d'exécution](#mode-dexécution-du-contrôle-total) pour les actions à fort impact). Le droit est celui que la route vérifie dans la société ; l'outil vérifie le même, action par action pour un outil qui regroupe plusieurs routes.

| | Gestionnaires | Couverts par un outil | Exclus |
| --- | --- | --- | --- |
| Qui modifient des données (POST, PUT, PATCH, DELETE) | 227 | 186 | 41 |
| Lectures (GET) | 182 | 154 | 28 |
| Total | 409 | 340 | 69 |

### Exclusions

| Exclusion | Raison | Gestionnaires (dont écritures) |
| --- | --- | --- |
| Authentification | Authentification du navigateur (Better Auth : connexion, sessions, fournisseur OAuth) ; un assistant se connecte par OAuth ou par clé API. | 2 (1) |
| Compte personnel | Compte personnel de l'utilisateur (identité, mot de passe, sessions, préférences d'affichage) ; un assistant n'agit jamais sur l'identité ni la sécurité du compte. | 11 (8) |
| Accès des assistants | Accès des assistants (clés API, autorisations, mode d'exécution) ; un assistant ne peut pas modifier ses propres droits. | 4 (3) |
| Approbation des actions IA | Approbation des actions IA, réservée à la session et au mot de passe de l'utilisateur dans Kledg (mode validation) ; un assistant ne peut pas approuver. | 2 (1) |
| Serveur MCP | Le serveur MCP lui-même. | 3 (2) |
| Tâches planifiées | Tâche planifiée appelée par la plateforme avec son secret, jamais par un utilisateur. | 3 (0) |
| Disponibilité | Sonde de disponibilité de l'instance, sans donnée. | 1 (0) |
| Administration de l'instance | Administration de l'instance (utilisateurs, mises à jour, messagerie), hors de toute société ; reste dans les pages d'administration. | 14 (9) |
| Suppression d'une société | Suppression définitive d'une société : les livres sont conservés 10 ans (Code de commerce art. L123-22) ; une société qui en tient s'archive (archive_company), seule une société vide se supprime, dans Kledg. | 1 (1) |
| Connexion d'une banque | Connexion d'une banque et identifiants des prestataires (consentement et authentification forte à la banque, secrets) ; restent dans l'interface. | 16 (11) |
| Documents de l'approbation | Documents de l'approbation des comptes, générés et signés dans Kledg (voir « Ce que le serveur ne fait pas »). | 1 (0) |
| Factures de frais de gestion | Génération des factures de frais de gestion, décision du mainteneur du 2026-10-04 (voir « Ce que le serveur ne fait pas »). | 1 (1) |
| Aides de l'interface | Préférence ou aide de l'interface (tableau de bord, menu latéral, liste de démarrage, compteurs, aides de saisie), sans donnée comptable qu'un autre outil ne donne pas. | 10 (4) |

### Table des routes

| Route | Droit vérifié | Outils MCP (niveau) ou exclusion |
| --- | --- | --- |
| `GET /api/account/appearance` | session | Exclu : compte personnel |
| `PUT /api/account/appearance` | session | Exclu : compte personnel |
| `GET /api/account/display-mode` | session | Exclu : compte personnel |
| `PUT /api/account/display-mode` | session | Exclu : compte personnel |
| `POST /api/account/email` | session | Exclu : compte personnel |
| `POST /api/account/password` | session | Exclu : compte personnel |
| `PATCH /api/account/profile` | session | Exclu : compte personnel |
| `DELETE /api/account` | session | Exclu : compte personnel |
| `DELETE /api/account/sessions/[id]` | session | Exclu : compte personnel |
| `GET /api/account/sessions` | session | Exclu : compte personnel |
| `DELETE /api/account/sessions` | session | Exclu : compte personnel |
| `POST /api/accounting-changes` | entries:create | `manage_accounting_changes` (B) |
| `PATCH /api/accounting-changes/[id]` | entries:create | `manage_accounting_changes` (B) |
| `DELETE /api/accounting-changes/[id]` | entries:delete | `manage_accounting_changes` (B) |
| `POST /api/accounting-changes/[id]/entry` | entries:create | `manage_accounting_changes` (B) |
| `GET /api/accounting-methods` | reports:read | `get_annexe` (L) |
| `POST /api/accounting-methods` | entries:create | `manage_accounting_methods` (B) |
| `PATCH /api/accounting-methods/[id]` | entries:create | `manage_accounting_methods` (B) |
| `DELETE /api/accounting-methods/[id]` | entries:delete | `manage_accounting_methods` (B) |
| `GET /api/accounts/[id]/balance-evolution` | entries:read | `get_ledger_report` (L) |
| `GET /api/accounts/[id]/entries` | entries:read | `list_entries` (L) |
| `GET /api/accounts/[id]` | entries:read | `search_accounts` (L) |
| `DELETE /api/accounts/[id]` | ledger:manage | `manage_accounts` (CT) |
| `PATCH /api/accounts/[id]` | ledger:manage | `manage_accounts` (CT) |
| `GET /api/accounts/check-exists` | entries:read | `search_accounts` (L) |
| `POST /api/accounts/check-pcg-compliance` | ledger:manage | `manage_accounts` (CT) |
| `POST /api/accounts/delete-non-pcg` | ledger:manage | `manage_accounts` (CT) |
| `GET /api/accounts` | entries:read | `search_accounts` (L) |
| `POST /api/accounts` | ledger:manage | `create_account` (CT) |
| `POST /api/accounts/seed-pcg` | ledger:manage | `manage_accounts` (CT) |
| `GET /api/addresses/[id]` | settings:read | `get_company_settings` (L) |
| `GET /api/addresses` | settings:read | `get_company_settings` (L) |
| `POST /api/addresses` | settings:update | `manage_company_records` (CT) |
| `PUT /api/ai-access/api-keys/[id]` | session | Exclu : accès des assistants |
| `POST /api/ai-access/api-keys` | session | Exclu : accès des assistants |
| `PUT /api/ai-access/assistants` | session | Exclu : accès des assistants |
| `GET /api/ai-access/grants` | session | Exclu : accès des assistants |
| `POST /api/ai-actions/[id]` | session | Exclu : approbation des actions ia |
| `GET /api/ai-actions` | session | Exclu : approbation des actions ia |
| `GET /api/annexe/export` | reports:export | `export_report` (L) |
| `GET /api/annexe` | reports:read | `get_annexe` (L) |
| `PUT /api/annexe` | closing:execute | `update_annexe_notes` (B) |
| `GET /api/auth/[...all]` | aucun (voir exclusion) | Exclu : authentification |
| `POST /api/auth/[...all]` | aucun (voir exclusion) | Exclu : authentification |
| `PUT /api/banking/accounts/[id]` | banking:manage | `manage_bank_accounts` (CT) |
| `GET /api/banking/accounts` | banking:read | `get_bank_sync_status` (L), `list_bank_accounts` (CT) |
| `POST /api/banking/accounts/sync` | banking:manage | `manage_bank_accounts` (CT) |
| `GET /api/banking/attachments/[attachmentId]/proxy` | banking:read | `get_file` (L) |
| `POST /api/banking/attachments/sync` | banking:reconcile | `sync_bank_data` (CT) |
| `POST /api/banking/connections/[id]/refresh` | banking:reconcile | `sync_bank` (CT) |
| `DELETE /api/banking/connections/[id]` | banking:manage | `manage_bank_accounts` (CT) |
| `GET /api/banking/connections` | banking:read | `get_bank_sync_status` (L) |
| `POST /api/banking/import-statement` | banking:reconcile | `import_statement` (CT) |
| `GET /api/banking/institutions` | banking:read | Exclu : connexion d'une banque |
| `POST /api/banking/manual-accounts` | banking:manage | `create_bank_account` (CT) |
| `GET /api/banking/missing-receipts` | banking:read | `list_missing_receipts` (L) |
| `POST /api/banking/ponto` | banking:manage | Exclu : connexion d'une banque |
| `POST /api/banking/reconciliation/auto-reconcile` | banking:reconcile | `bulk_reconcile` (CT) |
| `GET /api/banking/reconciliation` | banking:read | `list_bank_transactions` (L), `list_entries` (L) |
| `POST /api/banking/reconciliation` | banking:reconcile | `reconcile_transaction` (CT) |
| `DELETE /api/banking/reconciliation` | banking:reconcile | `unreconcile_transaction` (CT) |
| `POST /api/banking/revolut/authorize` | banking:manage | Exclu : connexion d'une banque |
| `GET /api/banking/revolut/callback` | banking:manage | Exclu : connexion d'une banque |
| `GET /api/banking/revolut` | banking:manage | Exclu : connexion d'une banque |
| `POST /api/banking/revolut` | banking:manage | Exclu : connexion d'une banque |
| `POST /api/banking/select-account` | banking:manage | `manage_bank_accounts` (CT) |
| `PATCH /api/budget-lines/[id]` | budgets:manage | `update_budget_line` (B) |
| `DELETE /api/budget-lines/[id]` | budgets:manage | `delete_budget_items` (CT) |
| `POST /api/budgets/[id]/lines` | budgets:manage | `create_budget_line` (B) |
| `GET /api/budgets/[id]/report` | reports:read | `get_budget_report` (L) |
| `GET /api/budgets/[id]` | reports:read | `get_budget` (L) |
| `DELETE /api/budgets/[id]` | budgets:manage | `delete_budget_items` (CT) |
| `GET /api/budgets` | reports:read | `list_budgets` (L) |
| `POST /api/budgets` | budgets:manage | `create_budget` (B) |
| `GET /api/cash-forecast` | reports:read, banking:read | `get_cash_forecast` (L) |
| `GET /api/cash-forecast/alert` | reports:read, banking:read | `get_cash_forecast` (L) ; l'alerte de seuil du tableau de bord est le champ alert de get_cash_forecast. |
| `GET /api/cash-forecast/export` | reports:export, banking:read | `export_report` (L) |
| `POST /api/companies/[id]/archive` | administrateur de l’instance | `archive_company` (CT) |
| `DELETE /api/companies/[id]/archive` | administrateur de l’instance | `restore_company` (CT) |
| `GET /api/companies/[id]/balance-sheet/compare` | reports:read | `get_balance_sheet` (L) ; Un appel par exercice. |
| `POST /api/companies/[id]/balance-sheet/config/default` | settings:update | `manage_statement_layout` (CT) |
| `GET /api/companies/[id]/balance-sheet/config/history` | settings:read | `get_statement_layout` (L) |
| `POST /api/companies/[id]/balance-sheet/config/history` | settings:update | `manage_statement_layout` (CT) |
| `GET /api/companies/[id]/balance-sheet/config/line/[lineId]` | settings:read | `get_statement_layout` (L) |
| `PATCH /api/companies/[id]/balance-sheet/config/line/[lineId]` | settings:update | `manage_statement_layout` (CT) |
| `DELETE /api/companies/[id]/balance-sheet/config/line/[lineId]` | settings:update | `manage_statement_layout` (CT) |
| `POST /api/companies/[id]/balance-sheet/config/line` | settings:update | `manage_statement_layout` (CT) |
| `GET /api/companies/[id]/balance-sheet/config` | settings:read | `get_statement_layout` (L) |
| `POST /api/companies/[id]/balance-sheet/config` | settings:update | `manage_statement_layout` (CT) |
| `GET /api/companies/[id]/balance-sheet/config/templates` | settings:read | `get_statement_layout` (L) |
| `POST /api/companies/[id]/balance-sheet/config/templates` | settings:update | `manage_statement_layout` (CT) |
| `GET /api/companies/[id]/balance-sheet/export-excel` | reports:export | `export_report` (L) |
| `GET /api/companies/[id]/balance-sheet/export-pdf` | reports:export | `export_report` (L) |
| `GET /api/companies/[id]/balance-sheet` | reports:read | `get_balance_sheet` (L) |
| `GET /api/companies/[id]/balance-sheet/validate-income-statement` | reports:read | `get_balance_sheet` (L), `get_income_statement` (L) |
| `POST /api/companies/[id]/corporate-tax/entries` | entries:create | `prepare_corporate_tax_entry` (B) |
| `GET /api/companies/[id]/corporate-tax/export` | reports:export | `export_report` (L) |
| `PUT /api/companies/[id]/corporate-tax/filing` | entries:create | `record_tax_filing` (B) |
| `DELETE /api/companies/[id]/corporate-tax/filing` | entries:create | `record_tax_filing` (B) |
| `PUT /api/companies/[id]/corporate-tax/inputs` | entries:create | `save_corporate_tax_inputs` (B) |
| `GET /api/companies/[id]/corporate-tax` | reports:read | `get_corporate_tax` (L) |
| `GET /api/companies/[id]/remuneration` | reports:read | `simulate_remuneration` (L) |
| `GET /api/companies/[id]/remuneration/export` | reports:export | `export_report` (L) |
| `PUT /api/companies/[id]/remuneration/scenarios` | closing:execute | `save_remuneration_scenario` (B) |
| `DELETE /api/companies/[id]/remuneration/scenarios` | closing:execute | `save_remuneration_scenario` (B) |
| `POST /api/companies/[id]/remuneration/propose-dividends` | closing:execute | `save_remuneration_scenario` (B), `update_year_end_formalities` (B) |
| `GET /api/companies/[id]/cash-forecast-settings` | settings:read | `get_company_settings` (L) |
| `PUT /api/companies/[id]/cash-forecast-settings` | settings:update | `update_company_settings` (CT) |
| `GET /api/companies/[id]/deadline-settings` | settings:read | `get_company_settings` (L) |
| `PUT /api/companies/[id]/deadline-settings` | settings:update | `update_company_settings` (CT) |
| `PUT /api/companies/[id]/declarations/status` | entries:create | `mark_declaration` (B) |
| `DELETE /api/companies/[id]/declarations/status` | entries:create | `mark_declaration` (B) |
| `PATCH /api/companies/[id]/establishments/[establishmentId]` | settings:update | `manage_company_records` (CT) |
| `DELETE /api/companies/[id]/establishments/[establishmentId]` | settings:update | `manage_company_records` (CT) |
| `GET /api/companies/[id]/establishments` | settings:read | `get_company_settings` (L) |
| `POST /api/companies/[id]/establishments` | settings:update | `manage_company_records` (CT) |
| `GET /api/companies/[id]/fiscal-years/[fiscalYearId]/approval/documents/[document]` | reports:export | Exclu : documents de l'approbation |
| `GET /api/companies/[id]/fiscal-years/[fiscalYearId]/approval` | reports:read | `get_year_end_formalities` (L) |
| `PUT /api/companies/[id]/fiscal-years/[fiscalYearId]/approval` | closing:execute | `update_year_end_formalities` (B) |
| `POST /api/companies/[id]/fiscal-years/[fiscalYearId]/close` | closing:execute | `close_fiscal_year` (CT) |
| `GET /api/companies/[id]/fiscal-years/[fiscalYearId]/close/simulate` | closing:execute | `close_fiscal_year` (CT) ; Aperçu (dryRun) de l'outil, droit closing:execute comme la route. |
| `GET /api/companies/[id]/fiscal-years/[fiscalYearId]/depreciation` | reports:read | `list_fixed_assets` (L), `generate_depreciation` (CT) ; Dotations à passer : aperçu (dryRun) de generate_depreciation. |
| `POST /api/companies/[id]/fiscal-years/[fiscalYearId]/depreciation` | entries:create, entries:validate | `generate_depreciation` (CT) |
| `GET /api/companies/[id]/fiscal-years/[fiscalYearId]/result-allocation` | reports:read | `allocate_result` (CT) ; Aperçu (dryRun) de l'outil. |
| `POST /api/companies/[id]/fiscal-years/[fiscalYearId]/result-allocation` | closing:execute | `allocate_result` (CT) |
| `GET /api/companies/[id]/fiscal-years/[fiscalYearId]` | entries:read | `list_fiscal_years` (L) |
| `PATCH /api/companies/[id]/fiscal-years/[fiscalYearId]` | ledger:manage | `manage_fiscal_years` (CT) |
| `DELETE /api/companies/[id]/fiscal-years/[fiscalYearId]` | ledger:manage | `manage_fiscal_years` (CT) |
| `POST /api/companies/[id]/fiscal-years/[fiscalYearId]/period-lock` | closing:execute | `manage_fiscal_years` (CT) |
| `GET /api/companies/[id]/fiscal-years` | entries:read | `list_fiscal_years` (L) |
| `POST /api/companies/[id]/fiscal-years` | ledger:manage | `manage_fiscal_years` (CT) |
| `POST /api/companies/[id]/income-statement/config/default` | settings:update | `manage_statement_layout` (CT) |
| `GET /api/companies/[id]/income-statement/config/line/[lineId]` | settings:read | `get_statement_layout` (L) |
| `PATCH /api/companies/[id]/income-statement/config/line/[lineId]` | settings:update | `manage_statement_layout` (CT) |
| `DELETE /api/companies/[id]/income-statement/config/line/[lineId]` | settings:update | `manage_statement_layout` (CT) |
| `POST /api/companies/[id]/income-statement/config/line` | settings:update | `manage_statement_layout` (CT) |
| `GET /api/companies/[id]/income-statement/config` | settings:read | `get_statement_layout` (L) |
| `POST /api/companies/[id]/income-statement/config` | settings:update | `manage_statement_layout` (CT) |
| `GET /api/companies/[id]/income-statement/export-excel` | reports:export | `export_report` (L) |
| `GET /api/companies/[id]/income-statement/export-pdf` | reports:export | `export_report` (L) |
| `GET /api/companies/[id]/income-statement` | reports:read | `get_income_statement` (L) |
| `POST /api/companies/[id]/local-taxes/entries` | entries:create | `prepare_cfe_entry` (B) |
| `GET /api/companies/[id]/local-taxes/export` | reports:export | `export_report` (L) |
| `GET /api/companies/[id]/local-taxes` | reports:read | `get_local_taxes` (L) |
| `PUT /api/companies/[id]/local-taxes` | entries:create | `save_local_taxes` (B) |
| `GET /api/companies/[id]/vat-deduction` | reports:read | `get_vat_deduction_coefficient` (L) |
| `PUT /api/companies/[id]/vat-deduction` | entries:create | `save_vat_deduction_settings` (B) |
| `POST /api/companies/[id]/vat-deduction/regularisation` | entries:create | `prepare_vat_coefficient_regularisation` (B) |
| `GET /api/companies/[id]/training-report` | reports:read | `get_training_report` (L) |
| `PUT /api/companies/[id]/training-report` | entries:create | `save_training_report` (B) |
| `PUT /api/companies/[id]/training-report/origins` | entries:create | `save_training_origins` (B) |
| `GET /api/companies/[id]/training-report/export` | reports:export | `export_report` (L) |
| `GET /api/companies/[id]/payroll-tax` | reports:read | `get_payroll_tax` (L) |
| `PUT /api/companies/[id]/payroll-tax` | entries:create | `save_payroll_tax` (B) |
| `POST /api/companies/[id]/payroll-tax/entries` | entries:create | `prepare_payroll_tax_entry` (B) |
| `PATCH /api/companies/[id]/members/[memberId]` | administrateur de l’instance | `manage_members` (CT) |
| `DELETE /api/companies/[id]/members/[memberId]` | administrateur de l’instance | `manage_members` (CT) |
| `GET /api/companies/[id]/members` | settings:read | `get_company_settings` (L) |
| `POST /api/companies/[id]/members` | administrateur de l’instance | `manage_members` (CT) |
| `GET /api/companies/[id]/onboarding` | entries:read | Exclu : aides de l'interface |
| `POST /api/companies/[id]/onboarding` | ledger:manage | Exclu : aides de l'interface |
| `GET /api/companies/[id]/opening-balances` | entries:read | `list_fiscal_years` (L), `list_entries` (L) |
| `POST /api/companies/[id]/opening-balances` | entries:create | `prepare_opening_balances` (B), `validate_entries` (CT) ; Brouillon, puis validation (entries:validate) comme l'option validate de la route. |
| `GET /api/companies/[id]/payment-terms` | settings:read | `get_company_settings` (L) |
| `PUT /api/companies/[id]/payment-terms` | settings:update | `update_company_settings` (CT) |
| `GET /api/companies/[id]/persons` | settings:read | `get_company_settings` (L) |
| `POST /api/companies/[id]/persons` | settings:update | `manage_company_records` (CT) |
| `GET /api/companies/[id]/persons/[personId]` | settings:read | `get_company_settings` (L) |
| `PATCH /api/companies/[id]/persons/[personId]` | settings:update | `manage_company_records` (CT) |
| `DELETE /api/companies/[id]/persons/[personId]` | settings:update | `manage_company_records` (CT) |
| `GET /api/companies/[id]` | settings:read | `get_company_settings` (L) |
| `PATCH /api/companies/[id]` | settings:update | `update_company_settings` (CT) |
| `DELETE /api/companies/[id]` | administrateur de l’instance | Exclu : suppression d'une société |
| `PATCH /api/companies/[id]/shareholders/[shareholderId]` | settings:update | `manage_company_records` (CT) |
| `DELETE /api/companies/[id]/shareholders/[shareholderId]` | settings:update | `manage_company_records` (CT) |
| `GET /api/companies/[id]/shareholders` | settings:read | `get_company_settings` (L) |
| `POST /api/companies/[id]/shareholders` | settings:update | `manage_company_records` (CT) |
| `GET /api/companies/[id]/sidebar-preferences` | settings:read | Exclu : aides de l'interface |
| `PUT /api/companies/[id]/sidebar-preferences` | settings:read | Exclu : aides de l'interface |
| `GET /api/companies/[id]/simple-mode-settings` | settings:read | `get_company_settings` (L) |
| `PUT /api/companies/[id]/simple-mode-settings` | settings:update | `update_company_settings` (CT) |
| `GET /api/companies/[id]/simple/counts` | banking:read | `list_expenses_to_review` (L) |
| `GET /api/companies/[id]/tax-regimes` | settings:read | `get_company_settings` (L) |
| `POST /api/companies/[id]/tax-regimes` | settings:update | `manage_company_records` (CT) |
| `PATCH /api/companies/[id]/tax-regimes` | settings:update | `manage_company_records` (CT) |
| `DELETE /api/companies/[id]/tax-regimes` | settings:update | `manage_company_records` (CT) |
| `GET /api/companies/[id]/vat-returns/export` | reports:export | `export_report` (L) |
| `PUT /api/companies/[id]/vat-returns/filing` | entries:create | `record_tax_filing` (B) |
| `DELETE /api/companies/[id]/vat-returns/filing` | entries:create | `record_tax_filing` (B) |
| `GET /api/companies/[id]/vat-returns` | reports:read | `get_vat_return` (L) |
| `POST /api/companies/[id]/vat-returns/settlement` | entries:create | `prepare_vat_settlement` (B) |
| `GET /api/companies/[id]/invoice-numbering` | settings:read | `get_company_settings` (L) |
| `PUT /api/companies/[id]/invoice-numbering` | settings:update | `update_company_settings` (CT) |
| `GET /api/companies/[id]/vat-settings` | settings:read | `get_company_settings` (L) |
| `PUT /api/companies/[id]/vat-settings` | settings:update | `update_company_settings` (CT) |
| `GET /api/companies/lookup` | politique de création des sociétés | `lookup_siren` (L) |
| `GET /api/companies` | session | `list_companies` (L) |
| `POST /api/companies` | politique de création des sociétés | `create_company` (CT) |
| `GET /api/cron/sync-banks` | aucun (voir exclusion) | Exclu : tâches planifiées |
| `GET /api/cron/sync-qonto` | aucun (voir exclusion) | Exclu : tâches planifiées |
| `GET /api/cron/period-locks` | aucun (voir exclusion) | Exclu : tâches planifiées |
| `GET /api/dashboard/layout` | reports:read | Exclu : aides de l'interface |
| `PUT /api/dashboard/layout` | reports:read | Exclu : aides de l'interface |
| `DELETE /api/dashboard/layout` | reports:read | Exclu : aides de l'interface |
| `GET /api/dashboard/widgets` | reports:read | Exclu : aides de l'interface |
| `GET /api/deadlines` | reports:read | `list_tax_deadlines` (L) |
| `POST /api/entries/[id]/duplicate` | entries:create | `duplicate_entry` (B) |
| `POST /api/entries/[id]/reverse` | entries:create, entries:validate | `reverse_entry` (CT) |
| `GET /api/entries/[id]` | entries:read | `get_entry` (L) |
| `PATCH /api/entries/[id]` | entries:update | `update_draft_entry` (CT), `validate_entries` (CT) |
| `DELETE /api/entries/[id]` | entries:delete | `delete_draft_entry` (CT) |
| `POST /api/entries/bulk-delete` | entries:delete | `delete_draft_entry` (CT) ; Un appel par brouillon. |
| `POST /api/entries/bulk-validate` | entries:validate | `validate_entries` (CT) |
| `GET /api/entries/next-number` | entries:read | `validate_entries` (CT) ; L'aperçu (dryRun) donne le numéro de chaque écriture. |
| `GET /api/entries` | entries:read | `list_entries` (L) |
| `POST /api/entries` | entries:create | `create_draft_entry` (B), `validate_entries` (CT) ; Brouillon, puis validation (entries:validate) pour une écriture créée validée. |
| `PATCH /api/expense-category-rules/[id]` | expenses:validate | `manage_expense_settings` (CT) |
| `DELETE /api/expense-category-rules/[id]` | expenses:validate | `manage_expense_settings` (CT) |
| `GET /api/expense-category-rules` | entries:read | `list_expense_category_rules` (L) |
| `POST /api/expense-category-rules` | expenses:validate | `manage_expense_settings` (CT) |
| `PATCH /api/expense-claimants/[id]` | expenses:validate | `manage_expense_settings` (CT) |
| `DELETE /api/expense-claimants/[id]` | expenses:validate | `manage_expense_settings` (CT) |
| `GET /api/expense-claimants/options` | expenses:validate | `manage_expense_settings` (CT) ; Action claimant_options, en lecture. |
| `GET /api/expense-claimants` | entries:read | `list_expense_claimants` (L) |
| `POST /api/expense-claimants` | expenses:validate | `manage_expense_settings` (CT) |
| `POST /api/expense-reports/[id]/post` | entries:create | `manage_expense_report` (CT) |
| `DELETE /api/expense-reports/[id]/post` | entries:delete | `manage_expense_report` (CT) |
| `GET /api/expense-reports/[id]/reimbursement` | expenses:validate, entries:read | `manage_expense_report` (CT) ; Action reimbursement_candidates, en lecture. |
| `POST /api/expense-reports/[id]/reimbursement` | entries:update | `manage_expense_report` (CT) |
| `GET /api/expense-reports/[id]` | entries:read | `get_expense_report` (L) |
| `PATCH /api/expense-reports/[id]` | expenses:submit | `update_draft_expense_report` (B) |
| `DELETE /api/expense-reports/[id]` | expenses:submit | `manage_expense_report` (CT) |
| `POST /api/expense-reports/[id]/workflow` | expenses:submit | `manage_expense_report` (CT) |
| `GET /api/expense-reports/receipts` | expenses:submit, banking:read | Exclu : aides de l'interface |
| `GET /api/expense-reports/meal-rule` | expenses:submit | `get_expense_report` (L), `create_draft_expense_report` (B) ; le partage des repas de l'exploitant est dans `meal` et `mealRule`. |
| `GET /api/expense-reports` | entries:read | `list_expense_reports` (L) |
| `POST /api/expense-reports` | expenses:submit | `create_draft_expense_report` (B) |
| `GET /api/fec` | reports:export | `export_fec` (CT) |
| `GET /api/fixed-assets/[id]/depreciation-status` | entries:read | `list_fixed_assets` (L) |
| `GET /api/fixed-assets/[id]/depreciation/[entryId]/candidates` | entries:read | `list_fixed_assets` (L) |
| `POST /api/fixed-assets/[id]/depreciation/[entryId]/post` | entries:create, entries:validate | `manage_depreciation_record` (CT) |
| `DELETE /api/fixed-assets/[id]/depreciation/[entryId]` | entries:delete | `manage_depreciation_record` (CT) |
| `PATCH /api/fixed-assets/[id]/depreciation/[entryId]` | entries:update | `save_depreciation_record` (B) |
| `POST /api/fixed-assets/[id]/depreciation` | entries:create | `save_depreciation_record` (B) |
| `GET /api/fixed-assets/[id]` | entries:read | `list_fixed_assets` (L) |
| `PATCH /api/fixed-assets/[id]` | ledger:manage | `manage_fixed_asset` (CT) |
| `DELETE /api/fixed-assets/[id]` | ledger:manage | `manage_fixed_asset` (CT) |
| `GET /api/fixed-assets` | entries:read | `list_fixed_assets` (L) |
| `POST /api/fixed-assets` | ledger:manage | `create_fixed_asset` (CT) |
| `GET /api/fixed-assets/stats` | entries:read | `list_fixed_assets` (L) |
| `GET /api/group/export` | reports:export | `export_report` (L) |
| `GET /api/group/alerts` | reports:read | `get_group_alerts` (L) |
| `GET /api/group/companies` | reports:read | `get_group_companies` (L) |
| `GET /api/group/deadlines` | reports:read | `get_group_deadlines` (L) |
| `GET /api/group/evolution` | reports:read | `get_group_evolution` (L) |
| `GET /api/group/indicators` | reports:read | `get_group_indicators` (L) |
| `GET /api/group/ledger` | reports:read | `get_group_ledger` (L) |
| `GET /api/group/persons` | reports:read | `get_group_shareholders` (L) |
| `GET /api/group/summary` | reports:read | `get_group_view`, `get_group_indicators` (L) |
| `GET /api/group/transactions` | reports:read | `list_group_transactions` (L) |
| `GET /api/group/treasury` | reports:read | `get_group_treasury` (L) |
| `GET /api/group/participations` | reports:read | `get_participations` (L) |
| `GET /api/group/view` | reports:read | `get_group_view` (L) |
| `GET /api/group/structure` | reports:read | `get_group_structure` (L) |
| `GET /api/group/tax` | reports:read | `simulate_tax_integration` (L) |
| `GET /api/group/simple-home` | reports:read | `get_group_view`, `get_group_treasury`, `get_group_deadlines`, `get_group_alerts` (L) ; les mêmes chiffres en mots simples |
| `GET /api/health` | aucun (voir exclusion) | Exclu : disponibilité |
| `POST /api/import/preview-fiscal-years` | entries:read | `import_accounting_file` (CT) ; Aperçu (dryRun) de l'import. |
| `POST /api/import` | entries:create, ledger:manage | `import_accounting_file` (CT) |
| `POST /api/instance/test-email` | administrateur de l’instance | Exclu : administration de l'instance |
| `GET /api/integrations/[id]/credentials` | banking:manage | Exclu : connexion d'une banque |
| `POST /api/integrations/[id]/features` | banking:manage | Exclu : connexion d'une banque |
| `POST /api/integrations/[id]/resources` | banking:manage | Exclu : connexion d'une banque |
| `PUT /api/integrations/[id]` | banking:manage | Exclu : connexion d'une banque |
| `POST /api/integrations/[id]/sync` | banking:reconcile | `sync_bank_data` (CT) |
| `GET /api/integrations` | banking:read | `get_bank_sync_status` (L) |
| `POST /api/integrations` | banking:manage | Exclu : connexion d'une banque |
| `POST /api/integrations/sync` | banking:reconcile | `sync_bank_data` (CT) |
| `POST /api/integrations/verify` | banking:manage | Exclu : connexion d'une banque |
| `PATCH /api/investment-grants/[id]` | entries:create | `update_investment_grant` (B) |
| `DELETE /api/investment-grants/[id]` | entries:delete | `delete_year_end_items` (CT) |
| `GET /api/investment-grants` | reports:read | `get_year_end_inventory` (L) |
| `POST /api/investment-grants` | entries:create | `create_investment_grant` (B) |
| `GET /api/invoices/[id]/attachment` | entries:read | `get_file` (L) |
| `PATCH /api/invoices/[id]/lines` | entries:update | `update_draft_invoice` (B) |
| `DELETE /api/invoices/[id]/payments/[paymentId]` | entries:update | `manage_invoice` (CT) |
| `GET /api/invoices/[id]/payments/candidates` | entries:read | `manage_invoice` (CT) ; Action payment_candidates, en lecture. |
| `POST /api/invoices/[id]/payments` | entries:update | `manage_invoice` (CT) |
| `POST /api/invoices/[id]/post` | entries:create | `manage_invoice` (CT) |
| `DELETE /api/invoices/[id]/post` | entries:delete | `manage_invoice` (CT) |
| `GET /api/invoices/[id]` | entries:read | `get_invoice` (L) |
| `PATCH /api/invoices/[id]` | entries:update | `update_draft_invoice` (B) |
| `DELETE /api/invoices/[id]` | entries:delete | `manage_invoice` (CT) |
| `POST /api/invoices/[id]/settle` | entries:update | `manage_invoice` (CT) |
| `POST /api/invoices/[id]/qonto` | entries:create | `manage_invoice` (CT) |
| `POST /api/invoices/import-qonto` | entries:create | `import_qonto_invoices` (CT) |
| `GET /api/invoices` | entries:read | `list_invoices` (L) |
| `POST /api/invoices` | entries:create | `create_draft_invoice` (CT) |
| `PATCH /api/journals/[id]` | ledger:manage | `manage_journals` (CT) |
| `DELETE /api/journals/[id]` | ledger:manage | `manage_journals` (CT) |
| `POST /api/journals/defaults` | ledger:manage | `manage_journals` (CT) |
| `POST /api/journals` | ledger:manage | `create_journal` (CT) |
| `GET /api/journals` | entries:read | `list_journals` (L) |
| `GET /api/lettering/accounts` | entries:read | `list_unlettered_lines` (CT) |
| `POST /api/lettering/auto` | entries:update | `auto_letter_account` (CT) |
| `GET /api/lettering` | entries:read | `list_unlettered_lines` (CT) |
| `POST /api/lettering` | entries:update | `letter_entry_lines` (CT) |
| `GET /api/lettering/suggestions` | entries:read | `list_unlettered_lines` (CT) |
| `POST /api/lettering/unletter` | entries:update | `unletter_entry_lines` (CT) |
| `GET /api/management-fees/conventions/[id]/invoices` | reports:read | `list_management_fee_conventions` (L) |
| `POST /api/management-fees/conventions/[id]/invoices` | entries:create | Exclu : factures de frais de gestion |
| `GET /api/management-fees/conventions/[id]/preview` | reports:read | `preview_management_fees` (L) |
| `GET /api/management-fees/conventions/[id]` | reports:read | `list_management_fee_conventions` (L) |
| `PATCH /api/management-fees/conventions/[id]` | entries:create | `manage_management_fee_convention` (CT) |
| `DELETE /api/management-fees/conventions/[id]` | entries:create | `manage_management_fee_convention` (CT) |
| `GET /api/management-fees/conventions` | reports:read | `list_management_fee_conventions` (L) |
| `POST /api/management-fees/conventions` | entries:create | `manage_management_fee_convention` (CT) |
| `GET /api/management-fees/subsidiaries` | reports:read | `list_management_fee_conventions` (L) |
| `GET /api/mcp` | aucun (voir exclusion) | Exclu : serveur mcp |
| `POST /api/mcp` | aucun (voir exclusion) | Exclu : serveur mcp |
| `DELETE /api/mcp` | aucun (voir exclusion) | Exclu : serveur mcp |
| `PUT /api/provisions/[id]/assessment` | entries:create | `record_provision_assessment` (B) |
| `DELETE /api/provisions/[id]/assessment` | entries:create | `delete_year_end_items` (CT) |
| `PATCH /api/provisions/[id]` | entries:create | `update_provision` (B) |
| `DELETE /api/provisions/[id]` | entries:delete | `delete_year_end_items` (CT) |
| `POST /api/provisions/doubtful-receivables/reclassify` | entries:create | `reclassify_doubtful_receivable` (B) |
| `GET /api/provisions/doubtful-receivables` | reports:read | `list_doubtful_receivables` (L) |
| `GET /api/provisions` | reports:read | `get_year_end_inventory` (L) |
| `POST /api/provisions` | entries:create | `create_provision` (B) |
| `GET /api/qonto/accounts` | banking:read | Exclu : connexion d'une banque |
| `POST /api/qonto/connect` | banking:manage | Exclu : connexion d'une banque |
| `GET /api/qonto/statements/[id]/proxy` | banking:read | `get_file` (L) |
| `GET /api/qonto/statements/[id]` | banking:read | `get_qonto_statements` (L) |
| `GET /api/qonto/statements` | banking:read | `get_qonto_statements` (L) |
| `POST /api/qonto/statements` | banking:read | `get_qonto_statements` (L) ; Liste des relevés, filtres dans le corps ; rien n'est importé. |
| `GET /api/qonto/status` | banking:read | `get_bank_sync_status` (L) |
| `POST /api/qonto/test-connection` | banking:manage | Exclu : connexion d'une banque |
| `GET /api/qonto/transactions/[id]/attachments` | banking:read | `list_qonto_receipts` (L) |
| `POST /api/qonto/transactions/[id]/attachments/upload` | banking:reconcile | `upload_receipt` (CT) |
| `POST /api/qonto/verify` | banking:manage | Exclu : connexion d'une banque |
| `GET /api/reports/aged-balance/export-excel` | reports:export | `export_report` (L) |
| `GET /api/reports/aged-balance` | reports:read | `get_aged_balance` (L) |
| `GET /api/reports/auxiliary-balance/export-excel` | reports:export | `export_report` (L) |
| `GET /api/reports/auxiliary-balance` | reports:read | `get_auxiliary_balance` (L) |
| `GET /api/reports/capital-composition` | reports:read | `get_capital_composition` (L) |
| `GET /api/reports/depreciation` | reports:read | `list_fixed_assets` (L) |
| `GET /api/reports/fixed-asset-movements/export` | reports:export | `export_report` (L) |
| `GET /api/reports/fixed-asset-movements` | reports:read | `get_fixed_asset_movements` (L) |
| `GET /api/reports/financial-indicators/export` | reports:export | `export_report` (L) |
| `GET /api/reports/financial-indicators` | reports:read | `get_sig` (L), `get_financial_ratios` (L) |
| `GET /api/reports/grand-livre` | reports:read | `get_ledger_report` (L) |
| `GET /api/reports/journal/export-excel` | reports:export | `export_report` (L) |
| `GET /api/reports/journal` | reports:read | `get_ledger_report` (L) |
| `GET /api/reports/tiers-flows` | reports:read | `get_tiers_flows` (L) |
| `GET /api/reports/trial-balance` | reports:read | `get_trial_balance` (L) |
| `GET /api/rule-templates` | banking:read | `list_rule_templates` (L) |
| `GET /api/rule-templates/[id]` | banking:read | `list_rule_templates` (L) |
| `POST /api/rule-templates/[id]/accounts` | ledger:manage | `add_rule_from_template` (CT) ; Option createMissingAccounts de l'outil. |
| `GET /api/simple/entries` | entries:read | `list_entries` (L) |
| `POST /api/simple/expenses/[id]/confirm` | banking:reconcile | `accept_expense_suggestion` (B), `validate_entries` (CT) ; Brouillon, puis validation (entries:validate) quand la société ne demande pas la revue du comptable. |
| `POST /api/simple/expenses/[id]/receipt` | banking:reconcile | `upload_receipt` (CT) |
| `POST /api/simple/expenses/confirm-all` | banking:reconcile | `accept_all_expense_suggestions` (B), `validate_entries` (CT) ; Brouillons, puis validation (entries:validate). |
| `GET /api/simple/expenses` | banking:read | `list_expenses_to_review` (L) |
| `POST /api/subscriptions/budget-item` | budgets:manage | `add_subscription_to_budget` (B) |
| `PUT /api/subscriptions/decision` | banking:reconcile | `classify_subscription` (B) |
| `GET /api/subscriptions` | banking:read | `list_detected_subscriptions` (L) |
| `GET /api/tasks/count` | banking:read | Exclu : aides de l'interface |
| `POST /api/tasks/refresh` | banking:reconcile | `sync_bank_data` (CT) |
| `GET /api/tiers/[id]` | entries:read | `list_tiers` (L) |
| `PATCH /api/tiers/[id]` | entries:update | `manage_tiers` (B) |
| `DELETE /api/tiers/[id]` | entries:delete | `delete_tiers` (CT) |
| `POST /api/tiers/attach-auxiliary` | entries:create | `manage_tiers` (B) |
| `GET /api/tiers` | entries:read | `list_tiers` (L) |
| `POST /api/tiers` | entries:create | `manage_tiers` (B) |
| `POST /api/transaction-rules/[id]/duplicate` | ledger:manage | `duplicate_rule` (CT) |
| `PUT /api/transaction-rules/[id]` | ledger:manage | `update_rule` (CT) |
| `DELETE /api/transaction-rules/[id]` | ledger:manage | `delete_rule` (CT) |
| `POST /api/transaction-rules/[id]/simulate` | banking:read | `simulate_rule` (L) |
| `POST /api/transaction-rules/execute` | banking:reconcile | `run_rules` (CT) |
| `GET /api/transaction-rules` | banking:read | `list_rules` (CT) |
| `POST /api/transaction-rules` | ledger:manage | `create_rule` (CT) |
| `POST /api/transaction-rules/simulate` | banking:read | `simulate_rule` (L) |
| `GET /api/transaction-rules/copy` | banking:read | `list_companies` (L), `list_rules` (CT) ; list_rules sur chaque autre société (droit banking:read dans chacune). |
| `POST /api/transaction-rules/copy` | ledger:manage | `copy_rules_from_company` (CT) |
| `POST /api/transactions/[id]/apply-rule` | banking:reconcile | `bulk_reconcile` (CT) |
| `GET /api/transactions/[id]/create-rule` | banking:read | `get_transaction_details` (L) |
| `GET /api/transactions/[id]/reconcile` | banking:read | `get_transaction_details` (L) |
| `POST /api/transactions/[id]/reconcile` | banking:reconcile | `reconcile_transaction` (CT) |
| `DELETE /api/transactions/[id]/reconcile` | banking:reconcile | `unreconcile_transaction` (CT) |
| `GET /api/transactions/[id]/suggest` | banking:read | `get_transaction_details` (L) |
| `POST /api/transactions/bulk-delete` | banking:manage | `delete_bank_transactions` (CT) |
| `POST /api/transactions/bulk-reconcile` | banking:reconcile | `bulk_reconcile` (CT) |
| `POST /api/transactions/bulk-unreconcile` | banking:reconcile | `bulk_reconcile` (CT) |
| `GET /api/transactions` | banking:read | `list_bank_transactions` (L) |
| `PUT /api/updates/channel` | administrateur de l’instance | Exclu : administration de l'instance |
| `POST /api/updates/connection` | administrateur de l’instance | Exclu : administration de l'instance |
| `DELETE /api/updates/connection` | administrateur de l’instance | Exclu : administration de l'instance |
| `GET /api/updates/github` | administrateur de l’instance | Exclu : administration de l'instance |
| `GET /api/updates/history` | administrateur de l’instance | Exclu : administration de l'instance |
| `POST /api/updates/install` | administrateur de l’instance | Exclu : administration de l'instance |
| `POST /api/updates/prepare` | administrateur de l’instance | Exclu : administration de l'instance |
| `GET /api/updates` | administrateur de l’instance | Exclu : administration de l'instance |
| `GET /api/updates/version` | administrateur de l’instance | Exclu : administration de l'instance |
| `PATCH /api/users/[id]` | administrateur de l’instance | Exclu : administration de l'instance |
| `DELETE /api/users/[id]` | administrateur de l’instance | Exclu : administration de l'instance |
| `GET /api/users` | administrateur de l’instance | Exclu : administration de l'instance |
| `POST /api/users` | administrateur de l’instance | Exclu : administration de l'instance |
| `POST /api/year-end/entries` | entries:create | `prepare_year_end_entries` (B) |
| `GET /api/year-end` | reports:read | `get_year_end_inventory` (L) |
