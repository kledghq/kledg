# Principes Comptables à Tester - PCG 2026

Ce document liste tous les principes comptables français (PCG 2026) qui doivent être testés pour garantir la conformité de l'application.

## Principes Fondamentaux

### 1. Image Fidèle, Régularité et Sincérité
- ✅ Les comptes doivent présenter une image fidèle de la situation financière
- ✅ Les règles doivent être appliquées avec sincérité et conformité
- ✅ Tous les éléments doivent être réguliers

**Tests à créer :**
- [ ] Vérifier que tous les comptes sont correctement enregistrés
- [ ] Vérifier l'exactitude des calculs de soldes
- [ ] Vérifier qu'il n'y a pas de comptes fictifs ou erronés

### 2. Continuité d'Exploitation
- ✅ Supposer que l'entreprise poursuivra son activité
- ✅ Justifier tout changement de méthode ou d'estimation

**Tests à créer :**
- [ ] Vérifier la cohérence des méthodes d'évaluation d'un exercice à l'autre
- [ ] Vérifier que les changements de méthode sont documentés

### 3. Indépendance des Exercices
- ✅ Les produits et charges doivent être rattachés à l'exercice où ils ont été acquis/engagés
- ✅ Peu importe la date de paiement ou de perception

**Tests à créer :**
- [ ] Vérifier que les charges sont comptabilisées dans la bonne période
- [ ] Vérifier que les produits sont comptabilisés dans la bonne période
- [ ] Vérifier les comptes de régularisation (48, 19)

### 4. Prudence
- ✅ Ne pas anticiper les profits
- ✅ Enregistrer les pertes probables dès qu'elles sont identifiées
- ✅ Ne pas surévaluer les actifs ou les produits

**Tests à créer :**
- [ ] Vérifier que les dépréciations sont correctement enregistrées
- [ ] Vérifier que les provisions sont constituées
- [ ] Vérifier qu'aucun produit n'est anticipé

### 5. Permanence des Méthodes
- ✅ Les méthodes comptables doivent rester constantes d'un exercice à l'autre
- ✅ Tout changement doit être justifié et documenté

**Tests à créer :**
- [ ] Vérifier la cohérence des méthodes d'amortissement
- [ ] Vérifier la cohérence des méthodes d'évaluation des stocks

### 6. Non-Compensation
- ✅ Ne pas compenser des éléments d'actif avec des éléments de passif
- ✅ Ne pas compenser des produits avec des charges
- ✅ Tout doit être distinct dans le bilan ou compte de résultat

**Tests à créer :**
- [ ] Vérifier que les créances et dettes ne sont pas compensées
- [ ] Vérifier que les charges et produits ne sont pas compensés

### 7. Intangibilité du Bilan d'Ouverture
- ✅ Le bilan d'ouverture doit correspondre au bilan de clôture précédent
- ✅ Sauf pour le tout premier exercice

**Tests à créer :**
- [ ] Vérifier la continuité des soldes entre exercices
- [ ] Vérifier que le résultat de l'exercice précédent est bien intégré

## Principes Spécifiques - Bilan

### 8. Équilibre Actif/Passif
- ✅ ACTIF = PASSIF (obligatoire)
- ✅ Tolérance maximale : 0.01€

**Tests existants :** ✅
- [x] Test d'équilibre du bilan

### 9. Structure de l'Actif (PCG 2026)
- ✅ (I) Capital souscrit non appelé (comptes 10 débiteurs)
- ✅ (II) Actif immobilisé (20-27, net des 28XX et 29XX)
- ✅ (III) Actif circulant
  - Stocks et en-cours (classe 3, sauf 39)
  - Avances et acomptes versés (409)
  - Créances (classe 4 débiteurs, sauf 48 et 409)
  - Valeurs mobilières de placement (50, sauf 59)
  - Disponibilités (51, 53, 54, 55)
- ✅ (IV) Comptes de régularisation actif
  - Charges constatées d'avance (48 débiteurs)
  - Autres comptes de régularisation (19 débiteurs)

**Tests existants :** ✅ Partiellement
- [x] Test de calcul des immobilisations
- [ ] Test de calcul des stocks
- [ ] Test de calcul des créances
- [ ] Test de calcul des disponibilités
- [ ] Test des comptes de régularisation

### 10. Structure du Passif (PCG 2026)
- ✅ (I) Capitaux propres (classe 1, sauf 16, 17, 19)
- ✅ (II) Dettes
  - Emprunts et dettes assimilées (16-17)
  - Dettes fournisseurs et autres (classe 4 créditeurs, sauf 48)
- ✅ (III) Comptes de régularisation passif
  - Produits constatés d'avance (48 créditeurs)
  - Autres comptes de régularisation (19 créditeurs)

**Tests existants :** ✅ Partiellement
- [x] Test de calcul des capitaux propres
- [ ] Test de calcul des dettes
- [ ] Test des comptes de régularisation passif

## Principes Spécifiques - Compte de Résultat

### 11. Calcul des Charges (Classe 6)
- ✅ Charges = débit - crédit
- ✅ Soldes calculés uniquement sur la période

**Tests existants :** ✅
- [x] Test de calcul des charges

### 12. Calcul des Produits (Classe 7)
- ✅ Produits = crédit - débit
- ✅ Soldes calculés uniquement sur la période

**Tests existants :** ✅
- [x] Test de calcul des produits

### 13. Calcul du Résultat
- ✅ Résultat = Produits - Charges
- ✅ Résultat positif = bénéfice
- ✅ Résultat négatif = perte

**Tests existants :** ✅
- [x] Test de calcul du résultat

## Principes Spécifiques - Immobilisations

### 14. Conditions d'Inscription à l'Actif
- ✅ Le bien doit apporter un avantage économique futur
- ✅ Le coût doit pouvoir être évalué de façon fiable

**Tests à créer :**
- [ ] Vérifier que seuls les biens éligibles sont comptabilisés en immobilisations

### 15. Coût d'Entrée des Immobilisations
- ✅ Prix d'achat + frais accessoires
- ✅ Comptabilisation séparée des composants si durée/ caractéristiques diffèrent

**Tests à créer :**
- [ ] Vérifier le calcul du coût d'entrée
- [ ] Vérifier l'inclusion des frais accessoires

### 16. Amortissements (Comptes 28XX)
- ✅ Amortissement selon la durée d'utilité estimée
- ✅ Commence dès la mise en service
- ✅ Les comptes 28XX sont créditeurs
- ✅ Correspondance : 28XX → 2XX (ex: 2811 → 211)

**Tests existants :** ✅
- [x] Test de correspondance des comptes d'amortissement
- [x] Test de calcul de la valeur nette (Brut - Amortissements)
- [ ] Test de la durée d'amortissement
- [ ] Test de la date de mise en service

### 17. Dépréciations (Comptes 29XX)
- ✅ Si indicateurs de perte de valeur, activer des tests de dépréciation
- ✅ Valeur recouvrable = valeur d'utilité ou valeur de marché (plus élevée)
- ✅ Les comptes 29XX sont créditeurs
- ✅ Correspondance : 29XX → 2XX

**Tests existants :** ✅ Partiellement
- [x] Test de correspondance des comptes de dépréciation
- [ ] Test de calcul de la valeur recouvrable
- [ ] Test des indicateurs de perte de valeur

### 18. Valeur Nette Comptable
- ✅ Net = Brut - Amortissements - Dépréciations
- ✅ Net ≥ 0 (ne peut pas être négatif)

**Tests existants :** ✅
- [x] Test de calcul de la valeur nette
- [x] Test que la valeur nette ne peut pas être négative

### 19. Catégorisation des Immobilisations
- ✅ Immobilisations incorporelles (20XX)
- ✅ Immobilisations corporelles (21-25XX)
- ✅ Immobilisations financières (26-27XX)

**Tests existants :** ✅
- [x] Test de catégorisation

## Principes Spécifiques - Stocks

### 20. Évaluation des Stocks (Classe 3)
- ✅ Coût d'entrée incluant achat, transport, préparation
- ✅ Méthodes d'évaluation (coût moyen, FIFO, etc.)
- ✅ Dépréciations si valeur nette réalisable < coût

**Tests à créer :**
- [ ] Test de calcul du coût d'entrée des stocks
- [ ] Test des méthodes d'évaluation (FIFO, coût moyen)
- [ ] Test des dépréciations de stocks (comptes 39XX)

### 21. Exclusion des Dépréciations de Stocks
- ✅ Les comptes 39XX (dépréciations de stocks) ne doivent pas être inclus dans le total des stocks

**Tests existants :** ✅
- [x] Test d'exclusion des comptes 39 dans le calcul des stocks

## Principes Spécifiques - Tiers (Classe 4)

### 22. Créances (Débiteurs)
- ✅ Soldes débiteurs (débit - crédit > 0)
- ✅ Exclure les comptes 48 et 409

**Tests à créer :**
- [ ] Test de calcul des créances
- [ ] Test d'exclusion des comptes 48 et 409

### 23. Dettes (Créditeurs)
- ✅ Soldes créditeurs (crédit - débit > 0)
- ✅ Exclure les comptes 48

**Tests à créer :**
- [ ] Test de calcul des dettes
- [ ] Test d'exclusion des comptes 48

### 24. Comptes de Régularisation (48)
- ✅ Charges constatées d'avance : 48 débiteurs (actif)
- ✅ Produits constatés d'avance : 48 créditeurs (passif)

**Tests à créer :**
- [ ] Test des charges constatées d'avance
- [ ] Test des produits constatés d'avance

### 25. Avances et Acomptes (409)
- ✅ Avances versées sur commandes : 409 débiteurs (actif)
- ✅ Exclure des créances générales

**Tests existants :** ✅ Partiellement
- [x] Test de calcul des avances commandes

## Principes Spécifiques - Financiers (Classe 5)

### 26. Disponibilités
- ✅ Comptes 51, 53, 54, 55
- ✅ Soldes débiteurs

**Tests existants :** ✅ Partiellement
- [x] Test de calcul des disponibilités

### 27. Valeurs Mobilières de Placement
- ✅ Comptes 50 (sauf 59 = dépréciations)
- ✅ Soldes débiteurs

**Tests existants :** ✅ Partiellement
- [x] Test de calcul des valeurs mobilières
- [x] Test d'exclusion des comptes 59

## Principes Spécifiques - Soldes Cumulés vs Période

### 28. Bilan : Soldes Cumulés
- ✅ Toutes les écritures jusqu'à la date de fin
- ✅ Photographie à une date donnée

**Tests existants :** ✅
- [x] Test des soldes cumulés pour le bilan

### 29. Compte de Résultat : Soldes sur Période
- ✅ Uniquement les écritures de la période
- ✅ Mesure de la performance sur la période

**Tests existants :** ✅
- [x] Test des soldes sur période pour le compte de résultat

## Principes Spécifiques - Capital et Réserves (Classe 1)

### 30. Capital Souscrit Non Appelé
- ✅ Comptes 10 avec solde débiteur
- ✅ Apparaît à l'actif

**Tests existants :** ✅ Partiellement
- [x] Test de calcul du capital non appelé

### 31. Capitaux Propres
- ✅ Classe 1 créditeurs, sauf 16, 17, 19
- ✅ Capital, réserves, résultat de l'exercice

**Tests existants :** ✅ Partiellement
- [x] Test de calcul des capitaux propres

### 32. Dettes Financières (16-17)
- ✅ Emprunts et dettes assimilées
- ✅ Soldes créditeurs

**Tests existants :** ✅ Partiellement
- [x] Test de calcul des dettes financières

## Principes Spécifiques - Comptes de Régularisation (19)

### 33. Comptes de Régularisation Actif
- ✅ Comptes 19 débiteurs
- ✅ Frais d'émission d'emprunt à étaler, Primes de remboursement, Ecarts de conversion

**Tests à créer :**
- [ ] Test des comptes de régularisation actif

### 34. Comptes de Régularisation Passif
- ✅ Comptes 19 créditeurs

**Tests à créer :**
- [ ] Test des comptes de régularisation passif

## Résumé des Tests à Créer

### Tests Prioritaires (Fonctionnalités Core)
- [ ] Tests des stocks (classe 3, méthodes d'évaluation, dépréciations)
- [ ] Tests des créances et dettes (classe 4)
- [ ] Tests des comptes de régularisation (48, 19)
- [ ] Tests des dettes financières (16-17)
- [ ] Tests de la continuité entre exercices

### Tests de Validation (Conformité PCG)
- [ ] Tests de non-compensation
- [ ] Tests de prudence (dépréciations, provisions)
- [ ] Tests d'indépendance des exercices
- [ ] Tests de permanence des méthodes

### Tests de Cas Limites
- [ ] Tests avec soldes négatifs
- [ ] Tests avec comptes vides
- [ ] Tests avec beaucoup d'écritures
- [ ] Tests de performance
