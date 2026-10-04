/**
 * Types and interfaces for financial reports
 */

export interface AccountBalance {
  accountId: string
  code: string
  label: string
  debit: number
  credit: number
  balance: number
}

export interface ReportPeriod {
  startDate: Date
  endDate: Date
}

export interface ImmobilisationDetail {
  accountId: string
  code: string
  label: string
  brut: number
  amortissements: number
  net: number
}

export interface BalanceSheetSection {
  code: string
  label: string
  accounts: AccountBalance[]
  brut?: number
  amortissements?: number
  net: number
  subSections?: BalanceSheetSection[]
}

/**
 * Structure complète du Bilan selon PCG 2026
 */

// ACTIF - Structure complète
export interface ActifStructure {
  // I. Capital souscrit non appelé
  capitalNonAppele: {
    total: number
    accounts: AccountBalance[]
  }
  
  // II. Actif immobilisé
  actifImmobilise: {
    // Immobilisations incorporelles (20)
    incorporelles: {
      brut: number
      amortissements: number
      net: number
      details: ImmobilisationDetail[]
    }
    // Immobilisations corporelles (21-25)
    corporelles: {
      brut: number
      amortissements: number
      net: number
      details: ImmobilisationDetail[]
    }
    // Immobilisations mises en concession (22)
    misesEnConcession: {
      brut: number
      amortissements: number
      net: number
      details: ImmobilisationDetail[]
    }
    // Immobilisations en cours (23)
    enCours: {
      brut: number
      amortissements: number
      net: number
      details: ImmobilisationDetail[]
    }
    // Participations et créances rattachées (26)
    participations: {
      brut: number
      amortissements: number
      net: number
      details: ImmobilisationDetail[]
    }
    // Autres immobilisations financières (27)
    autresFinancieres: {
      brut: number
      amortissements: number
      net: number
      details: ImmobilisationDetail[]
    }
    // Totaux
    brutTotal: number
    amortissementsTotal: number
    netTotal: number
  }
  
  // II. Frais d'établissement (201)
  fraisEtablissement: {
    brut: number
    amortissements: number
    net: number
    details: ImmobilisationDetail[]
  }
  
  // III. Actif circulant
  actifCirculant: {
    // Stocks et en-cours selon Art. 821-1 IR4
    stocks: {
      matieresPremieres: {
        total: number
        accounts: AccountBalance[]
      }
      enCoursProduction: {
        total: number
        accounts: AccountBalance[]
      }
      produitsFinis: {
        total: number
        accounts: AccountBalance[]
      }
      marchandises: {
        total: number
        accounts: AccountBalance[]
      }
      total: number
      accounts: AccountBalance[]
    }
    // Avances et acomptes versés sur commandes (4091)
    avancesCommandes: {
      total: number
      accounts: AccountBalance[]
    }
    // Créances selon Art. 821-1 IR4
    creances: {
      clients: {
        total: number
        accounts: AccountBalance[]
      }
      autres: {
        total: number
        accounts: AccountBalance[]
      }
      total: number
      accounts: AccountBalance[]
    }
    // Charges constatées d'avance (48 débiteurs)
    chargesConstatees: {
      total: number
      accounts: AccountBalance[]
    }
    // Capital souscrit appelé, non versé (486, 4562)
    capitalAppeleNonVerse: {
      total: number
      accounts: AccountBalance[]
    }
    // Valeurs mobilières de placement selon Art. 821-1 IR4
    valeursMobilieres: {
      actionsPropres: {
        total: number
        accounts: AccountBalance[]
      }
      autresTitres: {
        total: number
        accounts: AccountBalance[]
      }
      total: number
      accounts: AccountBalance[]
    }
    // Instruments financiers à terme et jetons détenus (nouveau PCG 2026)
    instrumentsFinanciersTerme: {
      total: number
      accounts: AccountBalance[]
    }
    // Disponibilités (51(D), 52(D), 53)
    disponibilites: {
      total: number
      accounts: AccountBalance[]
    }
    total: number
  }
  
  // V. Frais d'émission des emprunts (481)
  fraisEmissionEmprunts: {
    total: number
    accounts: AccountBalance[]
  }
  
  // VI. Primes de remboursement des emprunts (169)
  primesRemboursementEmprunts: {
    total: number
    accounts: AccountBalance[]
  }
  
  // VII. Écarts de conversion et différences d'évaluation - Actif (474, 476)
  ecartsConversionActif: {
    total: number
    accounts: AccountBalance[]
  }
  
  total: number
}

// PASSIF - Structure complète
export interface PassifStructure {
  // I. Capitaux propres
  capitauxPropres: {
    // Capital [dont versé] (101, 108)
    capital: {
      total: number
      dontVerse: number
      accounts: AccountBalance[]
    }
    // Primes d'émission, de fusion, d'apport (104)
    primesCapital: {
      total: number
      accounts: AccountBalance[]
    }
    // Ecarts de réévaluation (105)
    ecartsReevaluation: {
      total: number
      accounts: AccountBalance[]
    }
    // Ecart d'équivalence (107)
    ecartEquivalence: {
      total: number
      accounts: AccountBalance[]
    }
    // Réserves selon Art. 821-1 IR4
    reserves: {
      reserveLegale: {
        total: number
        accounts: AccountBalance[]
      }
      reservesStatutaires: {
        total: number
        accounts: AccountBalance[]
      }
      reservesReglementees: {
        total: number
        accounts: AccountBalance[]
      }
      autresReserves: {
        total: number
        accounts: AccountBalance[]
      }
      total: number
      accounts: AccountBalance[]
    }
    // Report à nouveau (11) - montants négatifs entre parenthèses
    reportANouveau: {
      total: number
      accounts: AccountBalance[]
    }
    // Résultat de l'exercice [bénéfice ou perte] (12) - montants négatifs entre parenthèses, acomptes distincts
    resultatExercice: {
      total: number
      acomptesDividendes: number
      accounts: AccountBalance[]
    }
    // Subventions d'investissement (13)
    subventionsInvestissement: {
      total: number
      accounts: AccountBalance[]
    }
    // Provisions réglementées (14)
    provisionsReglementees: {
      total: number
      accounts: AccountBalance[]
    }
    total: number
  }
  
  // II. Autres fonds propres
  autresFondsPropres: {
    // Fonds non remboursables (1671)
    fondsNonRemboursables: {
      total: number
      accounts: AccountBalance[]
    }
    // Avances conditionnées (1673, 1674)
    avancesConditionnees: {
      total: number
      accounts: AccountBalance[]
    }
    // Droits du concédant (229)
    droitsConcedant: {
      total: number
      accounts: AccountBalance[]
    }
    total: number
  }
  
  // III. Provisions
  provisions: {
    // Provisions pour risques (151)
    provisionsRisques: {
      total: number
      accounts: AccountBalance[]
    }
    // Provisions pour charges (152)
    provisionsCharges: {
      total: number
      accounts: AccountBalance[]
    }
    total: number
  }
  
  // IV. Dettes selon Art. 821-1 IR4
  dettes: {
    // Emprunts obligataires convertibles (161)
    empruntsObligatairesConvertibles: {
      total: number
      accounts: AccountBalance[]
    }
    // Autres emprunts obligataires (163)
    autresEmpruntsObligataires: {
      total: number
      accounts: AccountBalance[]
    }
    // Emprunts et dettes auprès des établissements de crédit (164, 51(C))
    empruntsEtablissementsCredit: {
      total: number
      accounts: AccountBalance[]
    }
    // Emprunts et dettes financières diverses (165, 166, 168, 17) - dont emprunts participatifs
    empruntsFinanciersDivers: {
      total: number
      dontEmpruntsParticipatifs: number
      accounts: AccountBalance[]
    }
    // Instruments financiers à terme (52(C))
    instrumentsFinanciersTerme: {
      total: number
      accounts: AccountBalance[]
    }
    // Avances et acomptes reçus sur commandes en cours (4191)
    avancesAcomptesRecus: {
      total: number
      accounts: AccountBalance[]
    }
    // Dettes fournisseurs et comptes rattachés (401, 403, 4081, 4088(c))
    dettesFournisseurs: {
      total: number
      accounts: AccountBalance[]
    }
    // Dettes fiscales et sociales (421, 422, 424, 426, 427, 428, 431, 437, 438, 44(C))
    dettesFiscalesSociales: {
      total: number
      accounts: AccountBalance[]
    }
    // Dettes sur immobilisations et comptes rattachés (269, 279, 404, 405, 4084, 4088(c))
    dettesImmobilisations: {
      total: number
      accounts: AccountBalance[]
    }
    // Autres dettes (4196, 4197, 4198, 45(C), 464, 468, 509, 487)
    autresDettes: {
      total: number
      accounts: AccountBalance[]
    }
    // Produits constatés d'avance (48 créditeurs)
    produitsConstates: {
      total: number
      accounts: AccountBalance[]
    }
    total: number
    dontMoinsUnAn: number // (1) Dont à moins d'un an (hors avances et acomptes reçus sur commandes en cours)
  }
  
  // V. Écarts de conversion et différences d'évaluation - Passif (475, 477)
  ecartsConversionPassif: {
    total: number
    accounts: AccountBalance[]
  }
  
  total: number
}

/**
 * Bilan complet selon structure PCG 2026
 */
export interface CompleteBalanceSheet {
  actif: ActifStructure
  passif: PassifStructure
  // Données brutes pour référence
  details: {
    class1: AccountBalance[]
    class2: AccountBalance[]
    class3: AccountBalance[]
    class4: AccountBalance[]
    class5: AccountBalance[]
  }
  // Vérification d'équilibre
  _debug?: {
    ecart: number
    actifTotal: number
    passifTotal: number
  }
}


export interface ConsolidatedGeneralLedgerEntry {
  accountId: string
  accountCode: string
  accountLabel: string
  companyId: string
  companyName: string
  debit: number
  credit: number
  balance: number
  entryCount: number
}

export interface ConsolidatedGeneralLedger {
  entries: ConsolidatedGeneralLedgerEntry[]
  totalDebit: number
  totalCredit: number
  companies: Array<{
    id: string
    name: string
  }>
}

export interface CashFlowSection {
  label: string
  items: Array<{
    label: string
    amount: number
  }>
  total: number
}

export interface ConsolidatedCashFlow {
  exploitation: CashFlowSection
  investissement: CashFlowSection
  financement: CashFlowSection
  variationTresorerie: number
  tresorerieDebut: number
  tresorerieFin: number
  companies: Array<{
    id: string
    name: string
    sharePercentage: number
  }>
}

export interface ConsolidatedRatios {
  rentabilite: {
    roe: number // Return on Equity
    roa: number // Return on Assets
    margeNette: number
    margeOperationnelle: number
  }
  liquidite: {
    ratioLiquidite: number
    ratioTresorerie: number
  }
  endettement: {
    ratioEndettement: number
    couvertureDette: number
  }
  efficacite: {
    rotationActifs: number
    rotationStocks: number
  }
}

export interface GroupKPIs {
  chiffreAffaires: number
  ebitda: number
  resultatNet: number
  tresorerieNette: number
  croissanceCA: number // En pourcentage
  evolutionRentabilite: number // En pourcentage
}

