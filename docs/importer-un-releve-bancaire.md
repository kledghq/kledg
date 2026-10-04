# Importer un relevé bancaire

Pour une banque sans synchronisation automatique (BoursoBank, Shine, banques de réseau...), Kledg importe les opérations à partir d'un fichier exporté depuis votre espace bancaire en ligne. C'est aussi la solution de secours quand la synchronisation d'une banque connectée est interrompue.

Le bouton **Importer un relevé** se trouve sur les pages **Banque** et **Relevés bancaires**. Il faut le rôle Comptable ou Administrateur de la société ; un compte en lecture seule ne peut pas importer.

## Déroulement

1. Choisissez le compte bancaire de Kledg à alimenter, puis le fichier. Vous pouvez aussi glisser le fichier depuis votre ordinateur sur la page **Banque** ou **Relevés bancaires** : la fenêtre d'import s'ouvre avec le fichier déjà analysé.
2. **Analyser le fichier** : Kledg détecte le format, l'encodage, la ligne d'en-tête et les colonnes, puis affiche un aperçu des premières opérations.
3. Vérifiez la correspondance des colonnes. Quand la détection n'est pas sûre (badge *Colonnes à vérifier*), le panneau de correspondance s'ouvre : choisissez la colonne de date, le libellé, et soit un montant signé, soit les colonnes Débit et Crédit. Vous pouvez aussi forcer le format des dates, le séparateur décimal, le modèle de banque ou la feuille d'un classeur Excel.
4. Contrôlez le résumé : opérations à importer, doublons exacts, doublons probables (voir plus bas), période couverte, total des débits et des crédits.
5. **Importer** : les opérations sont enregistrées en une seule fois (tout ou rien), prêtes pour le rapprochement.

Si certaines lignes sont illisibles (date impossible, montant non numérique), elles sont listées avec leur numéro de ligne et l'import demande une confirmation explicite avant d'enregistrer les lignes valides. Il en va de même quand le numéro de compte indiqué dans un fichier OFX ou camt.053 ne correspond pas au compte choisi.

## Formats acceptés

| Format | Détails |
| --- | --- |
| CSV | Séparateur point-virgule, virgule ou tabulation. Encodage UTF-8 (avec ou sans BOM) ou Windows-1252 / Latin-1, détecté automatiquement. Les lignes d'information placées au-dessus de l'en-tête (numéro de compte, solde...) sont ignorées. |
| Excel | Fichiers `.xlsx` (première feuille par défaut, ou la feuille choisie). Les anciens `.xls` doivent être réenregistrés en `.xlsx` ou en CSV. |
| OFX / QFX | OFX 1.x (SGML) et OFX 2.x (XML), y compris les montants à virgule décimale. Les opérations en attente sont ignorées. |
| camt.053 | Relevé ISO 20022 (versions 02 à 13). Seules les écritures comptabilisées (statut `BOOK`) sont importées. Une remise groupée dont le détail est fourni est éclatée en une opération par paiement. Un fichier contenant plusieurs comptes n'importe que celui choisi. |

Les relevés PDF ne sont pas lisibles : exportez les opérations dans l'un des formats ci-dessus.

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

Ces modèles sont établis d'après des exports réels publiés par des projets libres d'import bancaire (les sources sont citées dans `lib/banking/import/presets.ts`). Les banques modifient parfois leurs exports : si une colonne n'est pas reconnue, corrigez la correspondance dans l'aperçu. LCL n'a pas de modèle dédié faute de source vérifiable ; ses exports sont lus par la détection générique.

Quand votre banque le propose, préférez l'export **OFX** ou **camt.053** : ces formats indiquent le compte, l'identifiant unique de chaque opération et le statut comptabilisé, ce qui rend l'import plus sûr.

## Doublons

### Doublons exacts

Réimporter le même fichier, ou un fichier dont la période chevauche un import précédent, ne crée pas de doublon. Chaque opération reçoit une empreinte stable calculée sur le compte, la date de comptabilisation, le montant en centimes, le libellé normalisé et l'identifiant bancaire quand le fichier en fournit un. Deux opérations réellement identiques le même jour (deux paiements du même montant chez le même commerçant) restent distinctes grâce à leur rang dans la journée.

Une opération déjà présente via la synchronisation bancaire (Qonto par exemple) avec le même identifiant bancaire est aussi reconnue. Ces doublons exacts sont toujours ignorés.

### Doublons probables

Une même opération peut arriver par deux chemins avec des libellés différents : un export CSV puis un export OFX de la même période, ou un fichier importé après une synchronisation bancaire. Pour ces cas, une ligne nouvelle est signalée comme **doublon probable** quand le compte contient déjà une opération :

- du même montant au centime près, dans le même sens (débit ou crédit) ;
- à la même date de comptabilisation, ou à la même date de valeur quand le fichier et l'opération existante en ont une toutes les deux. Aucune tolérance de plus d'un jour n'est appliquée.

Le rapprochement se fait opération par opération : si le fichier contient trois lignes identiques et que le compte n'en a qu'une, une seule ligne est signalée. Une opération existante déjà reconnue (comme doublon exact ou probable) ne sert pas deux fois.

Les doublons probables ne sont jamais supprimés en silence. L'aperçu les liste avec l'opération déjà présente qu'ils recoupent (date, libellé, origine : import CSV, OFX... ou synchronisation bancaire). Ils sont ignorés par défaut ; décochez **Ignorer** sur une ligne, ou sur l'en-tête pour toutes, afin de les importer quand même (par exemple deux virements réels du même montant le même jour). Le résumé compte séparément les doublons exacts et les doublons probables.

À l'import, Kledg recalcule les doublons : une ligne conservée dans l'aperçu n'est importée que si elle est toujours un doublon probable à la même position et avec la même empreinte. Un aperçu périmé (fichier modifié, autre import entre-temps) ne peut donc rien importer d'inattendu.

## Fichiers d'exemple

Ces fichiers fictifs montrent les formats attendus ; ils sont aussi téléchargeables depuis la fenêtre d'import.

- [exemple-releve.csv](../public/examples/exemple-releve.csv) : CSV point-virgule, colonnes Date, Date de valeur, Libellé, Référence, Débit, Crédit
- [exemple-releve.ofx](../public/examples/exemple-releve.ofx) : OFX 2.2
- [exemple-releve-camt053.xml](../public/examples/exemple-releve-camt053.xml) : camt.053.001.02 avec une remise groupée et une opération en attente (non importée)

Sur une instance en ligne, ils sont servis sous `/examples/`.

## Limites de taille

Un fichier ne peut pas dépasser 20 Mo. Sur Vercel, la plateforme refuse toute requête de plus de 4,5 Mo avant qu'elle n'atteigne Kledg : découpez un relevé plus lourd par période.
