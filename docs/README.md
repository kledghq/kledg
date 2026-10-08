# Documentation

La documentation de Kledg est répartie en deux endroits :

- **Les guides d'utilisation** sont sur le site : [www.kledg.com/fr/docs](https://www.kledg.com/fr/docs). Ils s'adressent au dirigeant et à l'expert-comptable : à quoi sert chaque fonctionnalité, les étapes dans l'interface, les règles de droit expliquées, les limites à connaître. Leur source est dans le dépôt du site (`content/docs/fr`).
- **La documentation technique** est ici, dans `docs/` : architecture, conventions, sécurité, configuration, auto-hébergement, serveur MCP, et pour chaque fonctionnalité son fonctionnement technique (code, API, règles de calcul, droits, limites d'implémentation). Chaque page de fonctionnalité commence par un lien vers son guide.

## Technique

- [Architecture](architecture.md) : organisation du code et principes
- [Conventions](conventions.md) : règles d'écriture du code, appliquées par le lint et les tests (en anglais)
- [Design system](design-system.md) : jetons, composants et règles de l'interface (en anglais)
- [Audit de l'interface](ui-audit.md) : audit de chaque écran, octobre 2026 (en anglais)
- [Points d'extension](extension-points.md) : politique de l'instance et emplacements d'interface pour une instance personnalisée (en anglais)
- [Isolation des sociétés dans la base (RLS)](rls.md) : politiques PostgreSQL, rôle applicatif, contextes système (en anglais)
- [Configuration](configuration.md) : toutes les variables d'environnement
- [Auto-hébergement](self-hosting.md) : déployer Kledg sur Vercel et Neon, ou ailleurs ; [mettre à jour son instance](self-hosting.md#mettre-à-jour)
- [Serveur MCP](mcp.md) : outils, droits, journal d'audit, couverture des fonctionnalités et inventaire de l'API
- [Vues MCP](mcp-views.md) : vues interactives renvoyées par les outils du serveur MCP
- [Conformité](conformite.md) : mécanismes qui assurent la tenue de la comptabilité, le FEC et le RGPD

## Fonctionnalités : fonctionnement technique

Chaque page renvoie à son guide sur le site.

- [Membres et invitations](membres-et-invitations.md) : rôles, invitations par email des administrateurs de la société, acceptation, politique de l'instance
- [Connexions bancaires](connexions-bancaires.md) : Qonto, Revolut Business, Ponto, synchronisation planifiée
- [Importer un relevé bancaire](importer-un-releve-bancaire.md) : formats, détection, empreintes et doublons
- [Règles d'affectation](regles-d-affectation.md) : application des règles, écritures créées
- [Bibliothèque de règles](bibliotheque-de-regles.md) : modèles de règles, suggestions, copie depuis une autre société ; format d'un modèle et contribution
- [Lettrage et tiers](lettrage-et-tiers.md) : lettrage, balance auxiliaire, balance âgée, justificatifs manquants
- [Factures et tiers](factures-et-tiers.md) : tiers, factures, comptabilisation, TVA sur les encaissements, règlements, import Qonto
- [Justificatifs photographiés](justificatifs-photo.md) : photo d'un ticket ou d'une facture dans Claude, ChatGPT ou sur la page Justificatifs, rapprochement, stockage, limites et sécurité
- [Notes de frais](notes-de-frais.md) : bénéficiaires, TVA récupérable, indemnités kilométriques, comptabilisation
- [Mode simple](mode-simple.md) : affichage simple, standard ou expert, navigation
- [Modes d'affichage et menu personnalisé](modes-et-menu.md) : mode Standard, entrées et groupes du menu masqués
- [Catégories simples](categories-simples.md) : catégories et comptes, propositions, règles apprises, validation
- [Tableau de bord](tableau-de-bord.md) : widgets, sources de données, dispositions
- [Abonnements](abonnements.md) : détection des paiements récurrents
- [Budget](budget.md) : budget par compte et par mois, comparaison avec le réalisé
- [Prévision de trésorerie](prevision-tresorerie.md) : solde bancaire projeté, sources de la prévision, seuil d'alerte
- [Indicateurs financiers](indicateurs-financiers.md) : SIG, CAF, BFR, trésorerie nette, ratios, avec leurs comptes
- [Provisions et subventions](provisions-et-subventions.md) : provisions, dépréciations, subventions d'investissement, travaux de clôture
- [Approbation des comptes](approbation-des-comptes.md) : documents d'approbation selon la forme juridique, dépôt
- [Annexe, méthodes comptables et formulaires 2054, 2055, 2033-C](annexe-et-2054.md) : annexe selon la catégorie de taille, registre des méthodes, tableaux des immobilisations et des amortissements
- [Rémunération et dividendes](remuneration-dividendes.md) : simulation indicative rémunération, dividendes ou mixte, scénarios enregistrés
- [Organisme de formation](organisme-de-formation.md) : exonération de TVA, coefficient de déduction, bilan pédagogique et financier, taxe sur les salaires
- [Déclarations de TVA](declarations-tva.md) : CA3 et CA12, lignes et cases, liquidation
- [Impôt sur les sociétés](impot-societes.md) : résultat fiscal, taux, acomptes, écritures
- [Impôts locaux (CFE, CVAE)](impots-locaux.md) : CFE, CVAE, plafonnement
- [Échéances et suivi des déclarations](echeances.md) : calendrier, statuts, dépôts et paiements
- [Vue groupe](vue-groupe.md) : espace groupe d'une holding, flux et éliminations
- [Frais de gestion](frais-de-gestion.md) : conventions entre une holding et ses filiales
