# Bibliothèque de règles

Le guide d'utilisation (suggestions, ajout d'un modèle, TVA des modèles expliquée, copie depuis une autre société) est sur le site : [La bibliothèque de règles](https://www.kledg.com/fr/docs/la-bibliotheque-de-regles). Cette page décrit le fonctionnement technique : code, API, rapprochement des comptes, calcul des suggestions, format et contribution des modèles.

La bibliothèque propose des [règles d'affectation](regles-d-affectation.md) prêtes à l'emploi (56 modèles). Chaque modèle donne ses conditions, son écriture, son traitement de la TVA avec la raison et les sources officielles. Ajouter un modèle ouvre l'éditeur de règle prérempli, avec les comptes du plan de la société ; rien n'est enregistré sans validation.

## La page

`/<société>/rules/library` (Banque, Bibliothèque de règles). Droit de lecture des règles (`banking:read`) pour la consulter ; créer des comptes ou copier des règles demande le droit de gérer le plan et les règles (`ledger:manage`), comme la création d'une règle.

- **Suggérées pour vous** : voir [Suggestions](#suggestions). Les modèles déjà ajoutés n'y figurent pas.
- **Tous les modèles** : une carte dit **Déjà ajoutée** quand une règle porte le même nom ou les mêmes conditions, et **Règle proche** quand une règle existante reconnaît déjà les libellés du modèle.
- **Ajouter** ouvre `/rules/new?template=<id>` : l'éditeur charge le modèle (`GET /api/rule-templates/[id]`). Si le plan n'a pas un compte du modèle, **Créer et continuer** appelle `POST /api/rule-templates/[id]/accounts` (chaque compte créé sous le compte qu'il subdivise, dans l'exercice ouvert) ; **Continuer sans créer** garde le compte parent quand il existe, sinon le compte est à choisir dans l'éditeur.
- **Copier depuis une autre société** (`POST /api/transaction-rules/copy`) : sociétés où le rôle de l'utilisateur permet de lire les règles. Comptes adaptés au plan de la société (même code d'abord), comptes absents créés si la case est cochée (par défaut), avec le libellé de la société d'origine. Copies inactives par défaut ; une règle déjà présente (même nom ou mêmes conditions) n'est pas copiée.

## Comptes

Les modèles utilisent les comptes du PCG 2026 (`lib/accounting/pcg-data.ts`). À l'ajout, chaque compte est rapproché du plan de l'exercice ouvert (`lib/rules-library/account-mapping.ts`) :

| Compte du modèle | Choix |
| --- | --- |
| Charge ou produit (classes 6 et 7) | Une subdivision que la société a créée est préférée (6262 ou 626000 pour 626) ; un compte du PCG n'est jamais pris pour une subdivision (6271 « Frais sur titres » n'est pas utilisé pour 627). Plusieurs subdivisions : le code complété de zéros, sinon le code lui-même, sinon la première, signalée comme à vérifier. |
| TVA et tiers | Le code exact, puis le code complété de zéros (445660), puis une subdivision unique ; jamais une subdivision devinée parmi plusieurs. 445662 est préféré pour la TVA autoliquidée déductible, comme le modèle « Achat intracommunautaire » de l'éditeur. |
| Absent | Proposé à la création (libellé du PCG, sous le compte existant qu'il subdivise, PCG art. 932-1), sinon le compte parent de 3 chiffres au moins ; un compte n'est jamais créé sans votre accord. |

Une règle enregistre des codes de compte, résolus dans l'exercice de chaque transaction quand elle s'applique : un compte créé dans l'exercice ouvert doit aussi exister dans un autre exercice ouvert pour les transactions de cet exercice.

## TVA

| Traitement | Écriture | Exemples |
| --- | --- | --- |
| TVA déductible à 20 % | TVA détectée par la banque (Qonto), 20 % sinon, au 44566 | Télécom, énergie, honoraires, péages, parkings, carburant d'un utilitaire |
| Taux réduit | TVA détectée, le taux réduit sinon | Restaurants 10 %, presse 2,1 % |
| TVA détectée par la banque | Seule la TVA détectée est déduite, aucune sinon : le taux dépend de la facture | Frais bancaires, loyer, La Poste, Amazon, Google Workspace, AWS |
| Autoliquidation | 20 % sur le montant payé, au débit du 44566 (ou 445662) et au crédit du 4452 | Microsoft, Adobe, Google Ads, Meta, LinkedIn, Notion, GitHub, OpenAI, Anthropic, Canva |
| Déduction partielle | 80 % du montant avec la TVA à 20 % incluse, le reste sans TVA : 80 % de la TVA est déduite | Carburant d'une voiture particulière |
| TVA non déductible | Une ligne pour le montant payé, sans TVA | Train, taxi et VTC, avion, location et entretien d'une voiture particulière |
| Sans TVA | Une ligne pour le montant payé | Assurances, agios, URSSAF, retraite, IS, TVA, CFE, virements Stripe et SumUp |

Sources (chaque modèle cite les siennes) :

- taux normal : CGI art. 278, [BOI-TVA-LIQ-20](https://bofip.impots.gouv.fr/bofip/1376-PGP.html) ; électricité et gaz à 20 % abonnement compris depuis le 1er août 2025 : [BOI-RES-TVA-000209](https://bofip.impots.gouv.fr/bofip/14705-PGP.html) ;
- autoliquidation des services d'un fournisseur établi hors de France, dans l'UE ou non : CGI art. 283, 2, [BOI-TVA-DECLA-10-10-20](https://bofip.impots.gouv.fr/bofip/3218-PGP.html) § 130 ;
- transport de personnes à 10 % : CGI art. 279, b quater, [BOI-TVA-LIQ-30-20-60](https://bofip.impots.gouv.fr/bofip/477-PGP.html) ; exclu de la déduction : CGI ann. II [art. 206, IV, 2°, 5°](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036174761/), [BOI-TVA-DED-30-30-30](https://bofip.impots.gouv.fr/bofip/1193-PGP.html) ; vols internationaux exonérés : CGI art. 262, II, 8°, [BOI-TVA-CHAMP-20-60-10](https://bofip.impots.gouv.fr/bofip/2270-PGP.html) ;
- péages et stationnement déductibles : [BOI-TVA-DED-40-40](https://bofip.impots.gouv.fr/bofip/1109-PGP.html) ;
- restauration à 10 % (alcool à 20 %) : CGI art. 279, m, [BOI-TVA-LIQ-30-20-10-20](https://bofip.impots.gouv.fr/bofip/256-PGP.html) ; dépenses de restaurant déductibles : [BOI-TVA-DED-30-30-10](https://bofip.impots.gouv.fr/bofip/1190-PGP.html) ;
- carburants, 80 % pour les véhicules exclus de la déduction, 100 % pour les autres : CGI art. 298, 4, 1°, [BOI-TVA-DED-30-30-40](https://bofip.impots.gouv.fr/bofip/1194-PGP.html) ;
- voitures particulières (achat, location, entretien) : CGI ann. II art. 206, IV, 2°, 6° et 7°, [BOI-TVA-DED-30-30-20](https://bofip.impots.gouv.fr/bofip/1192-PGP.html) ;
- services postaux et timbres : CGI art. 261, 4, 11° et art. 261 C, 3°, [BOI-TVA-CHAMP-30-10-60-10](https://bofip.impots.gouv.fr/bofip/823-PGP.html) ;
- presse inscrite à la CPPAP à 2,1 % : CGI art. 298 septies, [BOI-TVA-SECT-40-10-10](https://bofip.impots.gouv.fr/bofip/918-PGP.html), [BOI-TVA-SECT-40-40](https://bofip.impots.gouv.fr/bofip/9291-PGP.html) ;
- assurances exonérées : CGI art. 261 C, 2°, [BOI-TVA-CHAMP-30-10-70](https://bofip.impots.gouv.fr/bofip/14279-PGP.html) ; opérations bancaires exonérées sauf option : CGI art. 261 C, 1° et 260 B, [BOI-TVA-SECT-50-10-10](https://bofip.impots.gouv.fr/bofip/1839-PGP.html) ;
- locaux nus exonérés sauf option du bailleur : CGI art. 261 D, 2° et 260, 2°, [BOI-TVA-CHAMP-30-10-50](https://bofip.impots.gouv.fr/bofip/2846-PGP.html), [BOI-TVA-CHAMP-50-10](https://bofip.impots.gouv.fr/bofip/730-PGP.html) ;
- impôts, cotisations et virements hors du champ (pas de contrepartie) : [BOI-TVA-CHAMP-10-10-10](https://bofip.impots.gouv.fr/bofip/162-PGP.html) ; frais Stripe sans TVA pour les comptes de l'UE hors Irlande : [page de Stripe](https://support.stripe.com/questions/global-taxation-of-stripe-fees).

Hôtels en déplacement : TVA non déductible pour les nuits des dirigeants et des salariés, même en déplacement professionnel (CGI ann. II art. 206, IV, 2°, 2° ; [BOI-TVA-DED-30-30-10](https://bofip.impots.gouv.fr/bofip/1190-PGP.html) ; [réponse à la question écrite n° 12225 du 12 décembre 2023](https://questions.assemblee-nationale.fr/q16/16-12225QE.htm)), comme le mode simple ; les repas facturés à part suivent la règle des restaurants et l'hébergement d'un client ou d'un fournisseur ouvre droit à déduction.

Laissés de côté faute de règle vérifiée sur une page officielle : les frais Stripe et SumUp (exonération ou autoliquidation non établie), la formation (exonérée seulement si l'organisme a l'attestation de la 3511-SD, et compte de charge à préciser) et les cadeaux clients (seuil de 73 € TTC revalorisé tous les cinq ans).

## Suggestions

`listRuleTemplates` (`lib/rules-library/manage-rule-templates.service.ts`) lit en une requête les transactions bancaires des 365 derniers jours, les plus récentes d'abord, 5 000 au plus (l'analyse le dit quand il y en a plus), avec les seules colonnes que les conditions lisent. `rankTemplateSuggestions` (`suggestions.ts`) les parcourt une fois : une transaction reconnue par une règle active de la société est comptée comme couverte, sinon chaque modèle qui la reconnaît compte une transaction. Le moteur est celui des règles (`lib/transactions/rule-matcher.ts`), expressions régulières en temps linéaire avec un budget par transaction ; la condition de sens vient en premier, si bien qu'un modèle de dépense s'arrête aussitôt sur un crédit. Coût : au plus 5 000 × (règles actives + 56 modèles) tests de conditions, en mémoire.

## Format d'un modèle

Les modèles sont des données versionnées dans `lib/rules-library/catalog/` (`finance.ts`, `services.ts`, `travel.ts`), au format `RuleTemplateSchema` (`lib/rules-library/template.ts`) :

```ts
{
  id: 'orange',                       // stable, kebab-case : ne jamais le renommer
  name: 'Orange (télécom)',
  category: 'telecom',                // RULE_TEMPLATE_CATEGORIES
  description: 'Abonnements Orange (internet, mobile, fixe), en frais de télécommunications (626).',
  conditions: [DEBIT, labelMatches('\\borange (sa|pro|business)\\b', 'ORANGE SA, ORANGE PRO, ORANGE BUSINESS')],
  lines: [standardVatLine('626')],    // comptes du PCG, jamais la ligne de banque
  vat: { treatment: 'standard', why: 'Fournisseur établi en France : TVA à 20 % ...' },
  sources: [SOURCES.standardRate],    // catalog/sources.ts
  samples: { match: ['PRLV SEPA ORANGE SA', 'ORANGE PRO'], noMatch: ['ORANGE BLEUE MULHOUSE'] },
}
```

- **Conditions** : la condition de sens d'abord (`DEBIT` ou `CREDIT`), puis le libellé en expression régulière, insensible à la casse, exécutée par le moteur linéaire (`lib/transactions/rule-regex.ts` : pas de références arrière ni de lookahead). Couvrez les variantes réelles des libellés bancaires (« OVH », « OVHCLOUD », « PRLV SEPA OVH ») et décrivez-les en mots (`labelMatches(pattern, mots)`), ce que la carte affiche.
- **Lignes** : les aides `standardVatLine`, `reducedVatLine`, `detectedVatLine`, `selfAssessedLine`, `noVatLine` ; `vatOnDebit` n'est jamais utilisé (il ne sert qu'aux avoirs clients).
- **TVA** : `treatment` dit ce que les lignes doivent contenir (voir le tableau ci-dessus) ; `why` l'explique en une phrase pour l'utilisateur.
- **Sources** : obligatoires dès que le traitement n'est pas la TVA déductible à 20 % ; pages officielles uniquement (BOFiP, Légifrance, impots.gouv), lues avant d'écrire le modèle. Dans le doute, laissez la TVA à la détection de la banque en le disant, ou ne proposez pas le modèle.
- **Exemples** : 2 à 4 libellés bancaires que les conditions reconnaissent, et des libellés proches qu'elles ne doivent pas reconnaître.

## Contribuer un modèle

1. Ajoutez le modèle dans le fichier de sa catégorie, ou une catégorie dans `RULE_TEMPLATE_CATEGORIES`.
2. Vérifiez la règle de TVA sur une page officielle et ajoutez la source à `catalog/sources.ts` si elle n'y est pas.
3. Lancez `pnpm vitest run lib/rules-library` : le test du catalogue (`lib/rules-library/__tests__/catalog.test.ts`) vérifie pour chaque modèle le format, les comptes du PCG, la cohérence de la TVA avec le traitement, les sources, que chaque expression se compile et reconnaît ses exemples et aucun libellé courant sans rapport, que l'écriture de 120 € s'équilibre avec la banque, et l'absence de tirets longs.
4. Ouvrez une pull request en citant la source.

## API et serveur MCP

| Route | Droit | Outil MCP |
| --- | --- | --- |
| `GET /api/rule-templates?companyId=` | `banking:read` | `list_rule_templates` (lecture) |
| `GET /api/rule-templates/[id]?companyId=` | `banking:read` | `list_rule_templates` avec `templateId` |
| `POST /api/rule-templates/[id]/accounts` | `ledger:manage` | `add_rule_from_template` avec `createMissingAccounts` |
| `GET /api/transaction-rules/copy?companyId=` | `banking:read` ici, puis dans chaque société lue | `list_companies`, `list_rules` |
| `POST /api/transaction-rules/copy` | `ledger:manage` ici, `banking:read` dans la société source | `copy_rules_from_company` |

`add_rule_from_template` et `copy_rules_from_company` sont des outils de contrôle total, au niveau de `create_rule` ([serveur MCP](mcp.md)). La copie vérifie le rôle de l'utilisateur dans les deux sociétés, et pour un assistant les sociétés choisies pour la connexion : une société hors d'atteinte répond « Société introuvable », comme une société qui n'existe pas. Chaque lecture d'une autre société se fait dans le périmètre de sécurité de cette seule société (`withUserContext`, [rls.md](rls.md)) ; aucune ne passe par un contexte système.
