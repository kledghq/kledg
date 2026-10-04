# Frais de gestion

Les services qu'une holding animatrice rend à ses filiales (direction, comptabilité, informatique, juridique) et leur refacturation : une convention par groupe de filiales, un prix calculé depuis les écritures validées, une facture de vente par filiale et par période dans la holding, et, sur demande, la facture d'achat proposée en brouillon à chaque filiale. Code : `lib/management-fees`, pages `/management-fees`, outils MCP `list_management_fee_conventions` et `preview_management_fees`.

## Holding et filiales

Une seule définition, dans tout Kledg (`lib/management-fees/holding.ts`) : **une société est la holding d'une autre quand elle figure parmi ses actionnaires** (page Informations de la filiale, actionnaire « Société »). Les filiales d'une holding sont ces sociétés, quel que soit le pourcentage détenu. L'entrée **Frais de gestion** (groupe Factures) n'apparaît que dans une holding qui a au moins une filiale accessible.

- La case « holding » des informations de la société (`isHolding`) dit qu'il s'agit d'une holding pure, sans activité : elle ne sert pas ici, puisqu'une holding qui facture des services à ses filiales est par définition animatrice.
- Aucun seuil de détention n'est imposé : il relève de la convention et du conseil de la société.

## Accès : chaque société est vérifiée

Rien n'est lu ni écrit dans une société sans le rôle de l'utilisateur dans cette société-là (`lib/management-fees/access.ts`) :

| Action | Holding | Chaque filiale de la convention |
| --- | --- | --- |
| Voir les conventions, calculer une période | `reports:read` | `reports:read` (son nom, son chiffre d'affaires) |
| Créer, modifier, supprimer une convention | `entries:create` | `reports:read` |
| Préparer les factures | `entries:create` | `reports:read`, et `entries:create` pour lui proposer la facture d'achat |

Une filiale dont l'utilisateur n'est pas membre répond « n'est pas accessible avec votre compte » (404, sans la nommer) ; un rôle en lecture seule dans une filiale répond 403 en la nommant. Les droits de toutes les filiales sont vérifiés avant la première écriture. Chaque lecture ou écriture dans une filiale s'exécute dans le périmètre d'isolation de cette filiale ([rls.md](rls.md)) : la base décide encore d'après les adhésions de l'utilisateur. Un assistant IA est en plus limité aux sociétés de son autorisation, filiales comprises.

## Convention

Page **Frais de gestion, Nouvelle convention**, API `GET|POST /api/management-fees/conventions`, `GET|PATCH|DELETE /api/management-fees/conventions/[id]`, `GET /api/management-fees/subsidiaries`.

- **Prix, coûts majorés d'une marge** (méthode du coût de revient majoré) : les charges retenues de la holding sur la période, multipliées par la part des charges consacrée aux filiales, puis majorées de la marge. Par défaut toute la classe 6, sauf 657 (valeur des immobilisations cédées), 6582 (pénalités et amendes, non déductibles, CGI art. 39, 2), 66 (charges financières), 67 (charges exceptionnelles), 686 et 687 (dotations financières et exceptionnelles), 695 à 699 (impôt sur les bénéfices). Seules les écritures validées comptent, hors écritures de clôture ; une période à cheval sur deux exercices additionne chacun sur sa part.
- **Prix, montant forfaitaire** : un montant HT par période, réparti entre les filiales.
- **Clé de répartition** : parts égales, chiffre d'affaires de chaque filiale (ses comptes 70 validés sur la période, lus dans ses propres livres), ou pourcentages fixés dont le total fait exactement 100 %.
- **Entrée et sortie d'une filiale** : une filiale partie à la convention une partie de la période paie au prorata de ses jours (parts égales et pourcentages) ou de son chiffre d'affaires de ces jours ; le montant entier est réparti entre les filiales présentes.
- **TVA** : un taux français par convention, 0 % obligatoire si la holding est en franchise en base (CGI art. 293 B).
- **Comptes** : produit de la holding (706 par défaut), charge proposée aux filiales (6226 par défaut) ; **série de factures** `<préfixe>-<année>-<numéro>` (FG-2026-001...).
- Une convention déjà facturée ne se supprime pas : on lui donne une date de fin. La modifier ne change pas les montants déjà facturés.

## Prix de pleine concurrence

Entre sociétés d'un groupe, un service se facture au prix que des sociétés indépendantes auraient convenu :

- Principes de l'OCDE applicables en matière de prix de transfert (2022), chapitre VII : un service ne se refacture que s'il a une valeur pour la filiale (§7.6) ; les activités d'actionnaire de la holding (sa propre gouvernance, son financement) ne se refacturent pas (§7.9 et 7.10), d'où la part des charges refacturables ; l'approche simplifiée des services à faible valeur ajoutée retient une marge de 5 % (§7.61). Les services de gestion se refacturent usuellement avec une marge de 5 à 10 %.
- BOFiP BOI-BIC-BASE-80 (CGI art. 57, transferts de bénéfices à l'étranger) : l'administration applique ces principes et rehausse un prix qui s'en écarte. Entre deux sociétés françaises, le même raisonnement passe par l'acte anormal de gestion (CGI art. 38 et 39, 1) : des frais sans service réel ou au-delà de sa valeur ne sont pas déductibles chez la filiale ; des frais inférieurs au coût sont un avantage consenti par la holding.

Kledg calcule et documente le prix (chaque facturation garde le détail du calcul : charges par compte, marge, clé et poids) ; il ne juge pas si la marge est de pleine concurrence. Une marge hors de 5 à 10 % est signalée.

## Calcul et arrondis

`lib/management-fees/compute.ts`, le seul moteur : l'aperçu, les factures et l'outil MCP l'appellent, si bien que le montant affiché est le montant facturé.

1. Coûts majorés : total HT = charges x part x (1 + marge), arrondi une fois au centime, demi-centime vers le haut ; la base est arrondie de même et la marge est la différence, donc base + marge = total.
2. Le total est réparti selon la clé en centimes : chaque part arrondie à l'inférieur, le reste à la plus grosse part (la première en cas d'égalité) ; les parts font toujours exactement le total.
3. La TVA de chaque part est celle de sa facture : base x taux, arrondie une fois (CGI ann. II art. 242 nonies A, I, 11°, `lib/invoices/amounts.ts`).

## Factures

Fiche d'une convention, **Calculer une période** puis **Préparer les factures**, API `GET /api/management-fees/conventions/[id]/preview`, `GET|POST /api/management-fees/conventions/[id]/invoices`.

- **Dans la holding** : une facture de vente en brouillon par filiale, par le module des factures (la filiale comme client, créée d'après son SIREN si besoin), numérotée dans la série de la convention, datée de la fin de la période ou de la date choisie. On la vérifie et la comptabilise depuis **Factures de vente**, comme toute facture.
- **Dans chaque filiale, sur demande** : la même facture en brouillon dans ses **Factures d'achat** (la holding comme fournisseur, le compte de charges de la convention). C'est une proposition : rien n'entre dans les livres de la filiale tant qu'un utilisateur de la filiale ne la comptabilise pas. Sans cette option, ou sans le droit de saisir dans la filiale, la filiale enregistre la facture reçue comme d'habitude (saisie ou import Qonto).
- **Jamais deux fois** : une facturation par convention, filiale et période (contrainte de la base) ; relancer la même période complète ce qui manque (la facture d'achat demandée après coup) sans recalculer ce qui est déjà facturé ; une période qui chevauche une période facturée est refusée.

Kledg ne passe aucune écriture de frais de gestion lui-même, ni dans la holding ni dans les filiales : pas de facture à établir ni à recevoir (4181, 4081) en fin d'exercice. Une facture datée de la fin de la période rattache le produit et la charge au bon exercice ; une prestation de fin d'exercice facturée après la clôture se régularise par une écriture saisie.

## Outils MCP

| Outil | Rôle |
| --- | --- |
| `list_management_fee_conventions` | Conventions de la holding, prix, marge, clé, TVA, filiales (sans leur nom quand la connexion ne peut pas les lire) ; droit `reports:read` |
| `preview_management_fees` | Calcul d'une période : charges retenues et exclues, base, marge, montant HT, TVA et TTC de chaque filiale ; `reports:read` dans la holding et dans chaque filiale |

Aucun outil ne prépare les factures : la décision se prend dans Kledg.
