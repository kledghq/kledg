# Importer un relevé bancaire

Le guide d'utilisation (exporter depuis sa banque, étapes de l'import, doublons expliqués, erreurs fréquentes) est sur le site : [Importer un relevé bancaire](https://www.kledg.com/fr/docs/importer-un-releve-bancaire). Cette page décrit le fonctionnement technique : formats et règles de lecture, modèles de banques, détection des doublons et limites.

L'import sert aux banques sans synchronisation et de secours quand une synchronisation est interrompue. Fenêtre **Importer un relevé** des pages **Banque** et **Relevés bancaires** (un fichier déposé sur ces pages ouvre la fenêtre avec le fichier déjà analysé).

Code : `lib/banking/import` (`parse.ts` détection et lecture, `tabular.ts` CSV et Excel, `encoding.ts`, `date.ts`, `amount.ts`, `ofx.ts`, `camt053.ts`, `presets.ts` modèles de banques, `dedupe.ts` doublons, `import-statement.service.ts`, `importer.ts`). API : `POST /api/banking/import-statement` (multipart), droit `banking:reconcile` (Comptable ou Administrateur ; la lecture seule ne peut pas importer). Outil MCP `import_statement` (contrôle total). Fichiers d'exemple : `public/examples/`.

## Déroulement

- **Analyse** : détection du format, de l'encodage, de la ligne d'en-tête et des colonnes, aperçu des premières opérations.
- **Correspondance des colonnes** : ouverte d'office quand la détection n'est pas sûre (badge *Colonnes à vérifier*). Date, libellé, et soit un montant signé, soit Débit et Crédit ; options forcées : format des dates, séparateur décimal, modèle de banque, feuille Excel.
- **Résumé** : opérations à importer, doublons exacts, doublons probables, période couverte, totaux des débits et des crédits.
- **Import** : enregistrement en une seule transaction (tout ou rien).

Lignes illisibles (date impossible, montant non numérique) : listées avec leur numéro de ligne (100 au plus, `MAX_ERRORS`), confirmation explicite exigée avant d'enregistrer les lignes valides. Même confirmation quand le numéro de compte d'un fichier OFX ou camt.053 ne correspond pas au compte choisi.

## Formats acceptés

| Format | Détails |
| --- | --- |
| CSV | Séparateur point-virgule, virgule ou tabulation. Encodage UTF-8 (avec ou sans BOM) ou Windows-1252 / Latin-1, détecté automatiquement. Les lignes d'information placées au-dessus de l'en-tête (numéro de compte, solde...) sont ignorées. |
| Excel | Fichiers `.xlsx` (première feuille par défaut, ou la feuille choisie). Les anciens `.xls` doivent être réenregistrés en `.xlsx` ou en CSV. |
| OFX / QFX | OFX 1.x (SGML) et OFX 2.x (XML), y compris les montants à virgule décimale. Les opérations en attente sont ignorées. |
| camt.053 | Relevé ISO 20022 (versions 02 à 13). Seules les écritures comptabilisées (statut `BOOK`) sont importées. Une remise groupée dont le détail est fourni est éclatée en une opération par paiement. Un fichier contenant plusieurs comptes n'importe que celui choisi. |

Les relevés PDF ne sont pas lus.

### Dates et montants

- Dates : `JJ/MM/AAAA`, `JJ/MM/AA`, `AAAA-MM-JJ` (avec ou sans heure), `AAAAMMJJ`, et `MM/JJ/AAAA` sur demande. La date retenue est le jour écrit par la banque, sans décalage de fuseau horaire.
- Montants : `1 234,56`, `-1234,56`, `1.234,56`, `1,234.56`, `1234.56`, avec espaces insécables, symbole `€` ou code `EUR`, signe en fin de nombre ou parenthèses. Les montants sont convertis en centimes exacts, sans arrondi.
- Une colonne de montant signé (négatif pour un débit) ou deux colonnes Débit et Crédit, quel que soit le signe écrit dans la colonne Débit.
- Les opérations de montant nul et les lignes de solde ou de total sont ignorées. Les lignes dont la colonne Statut indique une opération en attente, refusée ou annulée sont ignorées.

## Banques reconnues

Kledg reconnaît automatiquement les exports CSV suivants d'après leur ligne d'en-tête. Pour une autre banque, les colonnes sont repérées par leur nom (Date, Date opération, Date valeur, Libellé, Montant, Débit, Crédit, Référence...) ou, à défaut, par leur contenu.

| Banque | En-tête reconnu | Particularités |
| --- | --- | --- |
| BNP Paribas | `Date operation;Libelle court;Type operation;Libelle operation;Montant operation en euro` | Une ligne de compte au-dessus de l'en-tête |
| Société Générale | `Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise` | Ligne de compte au-dessus, Windows-1252 |
| Crédit Agricole | `Date;Libellé;Débit Euros;Crédit Euros` | Une dizaine de lignes d'information au-dessus, libellés sur plusieurs lignes |
| Banque Populaire, Caisse d'Epargne | `Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;...;Debit;Credit;Date operation;Date de valeur` | |
| Crédit Mutuel, CIC | `Date;Date de valeur;Débit;Crédit;Libellé;Solde` ou `Date;Date de valeur;Montant;Libellé;Solde` | ISO-8859-15 |
| La Banque Postale | `Date;Libellé;Montant(EUROS)` | Six lignes d'information au-dessus |
| BoursoBank | `dateOp;dateVal;label;category;categoryParent;supplierFound;amount;...` | Dates `AAAA-MM-JJ` |
| Shine | `Transaction ID;Date de la valeur;Date d'opération;...;Débit;Crédit;...;Libellé;Nom de la contrepartie;...` | Windows-1252 |
| Qonto | Export en anglais (`Status,Settlement date (UTC),...,Total amount (incl. VAT),...,Transaction ID`) ou en français (`Statut;...;Montant total (TTC);...;Identifiant de transaction`) | Les opérations `processing` sont ignorées |
| Revolut Business | `Date started (UTC),Date completed (UTC),ID,Type,State,Description,...,Amount,...` | Les opérations `PENDING` sont ignorées ; `Total amount` (frais inclus) est pris quand il existe |

Ces modèles sont établis d'après des exports réels publiés par des projets libres d'import bancaire (les sources sont citées dans `lib/banking/import/presets.ts`). Une colonne non reconnue se corrige dans la correspondance des colonnes. LCL n'a pas de modèle dédié faute de source vérifiable ; ses exports sont lus par la détection générique.

OFX et camt.053 portent le compte, l'identifiant unique de chaque opération et le statut comptabilisé. Limites du lecteur OFX : profondeur 64 (`OFX_MAX_DEPTH`), balise de 1 024 caractères, texte de 64 Kio.

## Doublons

### Doublons exacts

Réimporter le même fichier, ou un fichier dont la période chevauche un import précédent, ne crée pas de doublon. Chaque opération reçoit une empreinte stable calculée sur le compte, la date de comptabilisation, le montant en centimes, le libellé normalisé et l'identifiant bancaire quand le fichier en fournit un. Deux opérations réellement identiques le même jour (deux paiements du même montant chez le même commerçant) restent distinctes grâce à leur rang dans la journée.

Une opération déjà présente via la synchronisation bancaire (Qonto par exemple) avec le même identifiant bancaire est aussi reconnue. Ces doublons exacts sont toujours ignorés.

### Doublons probables

Une même opération peut arriver par deux chemins avec des libellés différents : un export CSV puis un export OFX de la même période, ou un fichier importé après une synchronisation bancaire. Pour ces cas, une ligne nouvelle est signalée comme **doublon probable** quand le compte contient déjà une opération :

- du même montant au centime près, dans le même sens (débit ou crédit) ;
- à la même date de comptabilisation, ou à la même date de valeur quand le fichier et l'opération existante en ont une toutes les deux. Aucune tolérance de plus d'un jour n'est appliquée.

Le rapprochement se fait opération par opération : si le fichier contient trois lignes identiques et que le compte n'en a qu'une, une seule ligne est signalée. Une opération existante déjà reconnue (comme doublon exact ou probable) ne sert pas deux fois.

Les doublons probables ne sont jamais supprimés en silence : l'aperçu les liste avec l'opération existante recoupée (date, libellé, origine : import CSV, OFX... ou synchronisation bancaire). Ignorés par défaut, réimportables par la case **Ignorer** (ligne ou en-tête). Le résumé compte séparément les doublons exacts et les doublons probables.

À l'import, Kledg recalcule les doublons : une ligne conservée dans l'aperçu n'est importée que si elle est toujours un doublon probable à la même position et avec la même empreinte. Un aperçu périmé (fichier modifié, autre import entre-temps) ne peut donc rien importer d'inattendu.

## Fichiers d'exemple

Fichiers fictifs, aussi téléchargeables depuis la fenêtre d'import.

- [exemple-releve.csv](../public/examples/exemple-releve.csv) : CSV point-virgule, colonnes Date, Date de valeur, Libellé, Référence, Débit, Crédit
- [exemple-releve.ofx](../public/examples/exemple-releve.ofx) : OFX 2.2
- [exemple-releve-camt053.xml](../public/examples/exemple-releve-camt053.xml) : camt.053.001.02 avec une remise groupée et une opération en attente (non importée)

Sur une instance en ligne, ils sont servis sous `/examples/`.

## Limites de taille

Un fichier ne peut pas dépasser 20 Mo. Sur Vercel, la plateforme refuse toute requête de plus de 4,5 Mo avant qu'elle n'atteigne Kledg : un relevé plus lourd se découpe par période.
