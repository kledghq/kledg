# Changelog

Toutes les évolutions notables de Kledg sont consignées ici. Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Calendrier des **échéances** fiscales et juridiques (`/<société>/echeances`, entrée Échéances des États) et widget **Échéances** du tableau de bord (dirigeant et comptable par défaut) : TVA (CA3 mensuelle ou trimestrielle, CA12 et acomptes du réel simplifié jusqu'à sa suppression au 1er janvier 2027), acomptes et solde de l'IS, déclaration de résultat et liasse, DAS2 et 1330-CVAE sur demande, CFE et son acompte, approbation et dépôt des comptes. Chaque date cite sa règle et ses sources (CGI, BOFiP, Code de commerce, impots.gouv.fr), suit les reports de week-end et de jour férié de l'administration et reste indicative : l'espace professionnel sur impots.gouv.fr fait foi. Une carte **Échéances** de la page Informations règle ce que Kledg ne peut pas deviner (jour de la CA3, fréquence, acomptes, dépôt en ligne). Dates seulement, aucun montant.

- Nouveaux hébergements, chacun avec son fichier de configuration et sa section dans [docs/self-hosting.md](docs/self-hosting.md) : Railway (`railway.json`), Render (`render.yaml`, bouton « Deploy to Render »), Fly.io (`fly.toml`), Clever Cloud (`deploy/clevercloud.env`), Coolify et Dokploy (`docker-compose.yml`, désormais l'instance complète avec sa base ; la base de développement passe dans `docker-compose.dev.yml`). La page **Mises à jour** reconnaît l'hébergeur et propose la mise à jour en deux clics partout où une fusion sur GitHub redéploie l'instance (`KLEDG_DEPLOYS_FROM_GITHUB`). L'URL publique se déduit des variables de l'hébergeur quand `BETTER_AUTH_URL` n'est pas défini, et `GET /api/health` résiste aux rafales (une requête à la base toutes les deux secondes au plus, 503 en quatre secondes si la base ne répond pas).

- Page **Mises à jour** pour les administrateurs : version installée, dernière version, notes de version et migrations de la base à venir ; indicateur « Mise à jour disponible ». Sur Vercel, connexion GitHub par jeton fine-grained (chiffré) pour préparer, vérifier et installer une mise à jour, et choisir le canal suivi. Hors Vercel, commandes de mise à jour.

- Page **Profil** (`/settings/profile`) : nom et avatar à initiales, changement de l'adresse email confirmé par un lien envoyé à la nouvelle adresse (avec un avis à l'ancienne), mot de passe (l'ancienne page Mot de passe y mène), sessions actives avec déconnexion d'une session ou des autres, suppression du compte (refusée au dernier administrateur de l'instance ou d'une société). Chaque action respecte la politique de l'instance.

- Page **Apparence** (`/settings/appearance`) : le thème (clair, sombre ou système, le même réglage que le bouton de l'en-tête) et les couleurs des graphiques, enregistrées dans le compte et donc identiques sur tous les appareils. Quatre palettes, chacune pour le thème clair et le thème sombre (Sobre, les couleurs actuelles et la palette par défaut ; Contrasté ; Daltonisme, sur la base de la palette Okabe-Ito ; Pastel), ou des couleurs personnalisées par série (produits, charges, trésorerie, répartition des charges, débit, crédit, solde cumulé) et par thème, avec un aperçu, un avertissement quand une couleur manque de contraste avec le fond des cartes (moins de 3:1) et le retour aux couleurs par défaut. Les graphiques prennent les nouvelles couleurs dès l'enregistrement, sans recharger la page. Une instance peut restreindre ce réglage (action `change-appearance`).

### Modifié

- Le menu du compte est simplifié : identité, **Paramètres du compte**, documentation et déconnexion. Les pages de paramètres (compte et instance) se parcourent dans la barre latérale des paramètres.
- Le mode démo ne fait plus partie de Kledg : il vit dans une instance dérivée. Kledg propose à la place des points d'extension neutres, sans effet par défaut (politique de l'instance, emplacements d'interface, source de fichiers externe pour l'import de relevés), décrits dans [docs/extension-points.md](docs/extension-points.md). La variable `KLEDG_DEMO_MODE` et le script `demo:seed` sont supprimés.

### Corrigé

- Les journaux VT « Ventes » et CA « Caisse » que l'ouverture de la page Journaux ajoutait aux journaux de la société (VE et VT tous deux nommés « Ventes ») sont supprimés par une migration de données, seulement s'ils ne portent aucune écriture et qu'aucune règle d'affectation ne les utilise. Les journaux créés avec la société (AC, VE, BQ, OD, AN) ne changent pas.
- Chaque adresse appartient désormais à une société : seule cette société la retrouve, la consulte et la rattache à un établissement, y compris une adresse qui vient d'être créée et n'est encore rattachée à rien. Une migration attribue chaque adresse existante à la société qui l'utilise, duplique une adresse utilisée par plusieurs sociétés (chacune garde sa copie) et supprime les adresses qui ne servent plus. Une adresse remplacée ou retirée d'un établissement ou du siège est supprimée quand plus rien ne l'utilise.
- Le workflow *Update from Kledg* met à jour les copies créées par le bouton Vercel, dont l'historique Git est distinct de celui de Kledg, et ne bloque plus quand une version modifie des fichiers de workflow.

## [0.1.0] - 2026-10-03

Première version publique.

### Ajouté

- Comptabilité générale PCG 2026 : sociétés et établissements, membres et rôles, exercices avec clôture et à-nouveaux, plan de comptes, journaux, écritures avec contrôles PCG.
- Import FEC, CSV et Excel ; export FEC.
- Banque : import de relevés, synchronisation Qonto optionnelle (comptes, transactions, justificatifs), règles d'affectation, rapprochement.
- Immobilisations et plan d'amortissement linéaire, tableau des amortissements.
- États : bilan, compte de résultat (avec configuration), balance, grand livre, journal, exports PDF et Excel.
- Tableau de bord : indicateurs, chiffre d'affaires et charges, trésorerie.
- Serveur MCP (`/api/mcp`) pour connecter Claude, ChatGPT ou Claude Code, avec OAuth 2.1 ou clés API.
- Mode démo : société fictive, API Qonto simulée, réinitialisation nocturne.
- Auto-hébergement : déploiement en un clic sur Vercel avec Neon, page `/setup` pour le premier administrateur, emails via Resend.
