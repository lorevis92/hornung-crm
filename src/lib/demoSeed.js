// Seed used by DEMO MODE only. Mirrors supabase/migrations/..._seed.sql so the
// prototype behaves exactly like the real backend.

export const DOCUMENT_TYPES = [
  { id: 'current_tax_sheet', category: 'base', sort_order: 10, label_en: 'Current tax sheet', label_de: 'Aktuelles Steuerformular', label_fr: "Feuille d'impôt actuelle", label_it: "Foglio d'imposta attuale", help_en: 'The form/letter you received from the tax authority for this tax year.' },
  { id: 'last_tax_return', category: 'base', sort_order: 20, label_en: 'Copy of your last tax return', label_de: 'Kopie der letzten Steuererklärung', label_fr: 'Copie de votre dernière déclaration d’impôt', label_it: "Copia dell'ultima dichiarazione d'imposta" },
  { id: 'last_tax_assessment', category: 'base', sort_order: 30, label_en: 'Copy of your last tax assessment', label_de: 'Kopie der letzten Steuerveranlagung', label_fr: 'Copie de votre dernière taxation', label_it: "Copia dell'ultima tassazione" },
  { id: 'salary_statement', category: 'income', sort_order: 40, label_en: 'Salary statement (employees) / income and expense statement (self-employed)', label_de: 'Lohnausweis / Einnahmen- und Ausgabenrechnung (Selbständige)', label_fr: 'Certificat de salaire / compte de résultat (indépendants)', label_it: 'Certificato di salario / conto economico (indipendenti)', help_en: 'One statement per employer for the tax year.' },
  { id: 'alimony', category: 'income', sort_order: 50, label_en: 'Alimony agreement and bank statements showing donor and recipient (incl. date of birth)', label_de: 'Unterhaltsvereinbarung und Bankbelege mit Zahler und Empfänger', label_fr: 'Convention de pension alimentaire et relevés bancaires', label_it: 'Accordo di mantenimento ed estratti bancari' },
  { id: 'childcare_costs', category: 'deductions', sort_order: 60, label_en: 'Third-party childcare costs (e.g. day care)', label_de: 'Drittbetreuungskosten (z. B. Kita)', label_fr: 'Frais de garde par des tiers (p. ex. crèche)', label_it: 'Costi di custodia di terzi (es. asilo nido)' },
  { id: 'debt_certificates', category: 'deductions', sort_order: 70, label_en: 'Debt certificates as of 31.12 (credit cards, private loans, mortgages)', label_de: 'Schuldenausweise per 31.12.', label_fr: 'Attestations de dettes au 31.12', label_it: 'Attestazioni dei debiti al 31.12', help_en: 'Leasing cannot be deducted in an individual tax return.' },
  { id: 'pillar_3a', category: 'deductions', sort_order: 80, label_en: 'Pillar 3a certificate / voluntary contributions to the pension fund (BVG)', label_de: 'Bescheinigung Säule 3a / freiwillige Einkäufe (BVG)', label_fr: 'Attestation pilier 3a / rachats LPP', label_it: 'Attestazione pilastro 3a / riscatti LPP' },
  { id: 'health_insurance', category: 'deductions', sort_order: 90, label_en: 'Health insurance policy or yearly premium statement', label_de: 'Krankenkassenpolice oder Jahresprämienbescheinigung', label_fr: 'Police d’assurance maladie ou attestation de primes', label_it: 'Polizza cassa malati o attestazione dei premi' },
  { id: 'medical_costs', category: 'deductions', sort_order: 100, label_en: 'Non-reimbursed medical costs and invoices', label_de: 'Nicht rückerstattete Krankheitskosten', label_fr: 'Frais médicaux non remboursés', label_it: 'Spese mediche non rimborsate' },
  { id: 'donations', category: 'deductions', sort_order: 110, label_en: 'Certificate for voluntary donations', label_de: 'Bescheinigung für freiwillige Zuwendungen', label_fr: 'Attestation pour dons volontaires', label_it: 'Attestazione per donazioni volontarie' },
  { id: 'support_payments', category: 'deductions', sort_order: 120, label_en: 'Bank transfers to a financially supported person (name, date of birth, address)', label_de: 'Überweisungen an eine unterstützte Person', label_fr: 'Virements à une personne soutenue', label_it: 'Bonifici a una persona sostenuta' },
  { id: 'bank_statements', category: 'assets', sort_order: 130, label_en: 'Bank, crypto and securities statements as of 31.12 (Swiss and foreign), incl. custody accounts', label_de: 'Bank-, Krypto- und Wertschriftenausweise per 31.12.', label_fr: 'Relevés bancaires, crypto et titres au 31.12', label_it: 'Estratti bancari, crypto e titoli al 31.12', help_en: 'Count each account/wallet as one unit — the number of units affects the fee.' },
  { id: 'pension_fund', category: 'assets', sort_order: 140, label_en: 'Pension fund statement and/or vested benefits policies', label_de: 'Pensionskassenausweis und/oder Freizügigkeitspolicen', label_fr: 'Certificat de caisse de pension / libre passage', label_it: 'Certificato cassa pensione / libero passaggio' },
  { id: 'inheritance_gift', category: 'assets', sort_order: 150, label_en: 'Inheritance, gift, early withdrawal or BVG payment received in the tax year', label_de: 'Erbschaft, Schenkung, Vorbezug oder BVG-Auszahlung', label_fr: 'Héritage, donation, versement anticipé ou LPP', label_it: 'Eredità, donazione, prelievo anticipato o LPP' },
  { id: 'property_tax_value', category: 'property', sort_order: 160, label_en: 'Official tax value statement of Swiss properties', label_de: 'Amtliche Steuerwertbescheinigung', label_fr: 'Estimation fiscale officielle', label_it: 'Stima fiscale ufficiale' },
  { id: 'rental_contract_zug', category: 'property', sort_order: 170, label_en: 'Tenants in Canton Zug only: copy of the rental contract', label_de: 'Nur Mieter im Kanton Zug: Kopie des Mietvertrags', label_fr: 'Locataires à Zoug uniquement : copie du bail', label_it: 'Solo inquilini nel Canton Zugo: copia del contratto' },
  { id: 'other', category: 'other', sort_order: 900, label_en: 'Other document', label_de: 'Weiteres Dokument', label_fr: 'Autre document', label_it: 'Altro documento' }
]

// Mirrors document_categories, seeded in
// supabase/migrations/20260101000007_tax_extraction_schema.sql.
export const DOCUMENT_CATEGORIES = [
  { code: 'current_tax_sheet', group_key: 'base', sort_order: 10, label_en: "Current year's tax return form", label_de: 'Steuererklärungsformular (laufendes Jahr)', label_fr: "Formulaire de déclaration d'impôt (année en cours)", label_it: "Modulo dichiarazione d'imposta (anno corrente)" },
  { code: 'previous_tax_return', group_key: 'base', sort_order: 20, label_en: "Previous year's tax return", label_de: 'Steuererklärung Vorjahr', label_fr: "Déclaration d'impôt de l'année précédente", label_it: 'Dichiarazione d\'imposta anno precedente' },
  { code: 'previous_tax_assessment', group_key: 'base', sort_order: 30, label_en: "Previous year's tax assessment", label_de: 'Steuerveranlagung Vorjahr', label_fr: 'Décision de taxation de l\'année précédente', label_it: 'Tassazione anno precedente' },
  { code: 'salary_statement', group_key: 'income', sort_order: 40, label_en: 'Salary statement', label_de: 'Lohnausweis', label_fr: 'Certificat de salaire', label_it: 'Certificato di salario' },
  { code: 'self_employed_income_statement', group_key: 'income', sort_order: 50, label_en: 'Self-employment income statement', label_de: 'Erfolgsrechnung Selbständigerwerbende', label_fr: 'Compte de résultat (indépendant)', label_it: 'Conto economico (attività indipendente)' },
  { code: 'alimony_received', group_key: 'income', sort_order: 60, label_en: 'Alimony received', label_de: 'Erhaltene Unterhaltsbeiträge', label_fr: 'Pensions alimentaires reçues', label_it: 'Alimenti ricevuti' },
  { code: 'alimony_paid', group_key: 'deductions', sort_order: 70, label_en: 'Alimony paid', label_de: 'Geleistete Unterhaltsbeiträge', label_fr: 'Pensions alimentaires versées', label_it: 'Alimenti versati' },
  { code: 'childcare_costs', group_key: 'deductions', sort_order: 80, label_en: 'Childcare costs', label_de: 'Fremdbetreuungskosten Kinder', label_fr: 'Frais de garde des enfants', label_it: 'Spese di custodia dei figli' },
  { code: 'debt_certificate', group_key: 'deductions', sort_order: 90, label_en: 'Debt certificate', label_de: 'Schuldenverzeichnis / Schuldzinsbescheinigung', label_fr: 'Attestation de dettes', label_it: 'Attestato di debito' },
  { code: 'pillar_3a_certificate', group_key: 'deductions', sort_order: 100, label_en: 'Pillar 3a certificate', label_de: 'Bescheinigung Säule 3a', label_fr: 'Attestation du pilier 3a', label_it: 'Attestato del pilastro 3a' },
  { code: 'health_insurance_policy', group_key: 'deductions', sort_order: 110, label_en: 'Health insurance policy', label_de: 'Krankenkassenpolice', label_fr: "Police d'assurance-maladie", label_it: 'Polizza di assicurazione malattia' },
  { code: 'medical_costs', group_key: 'deductions', sort_order: 120, label_en: 'Medical costs', label_de: 'Krankheitskosten', label_fr: 'Frais de maladie', label_it: 'Spese mediche' },
  { code: 'donation_certificate', group_key: 'deductions', sort_order: 130, label_en: 'Donation certificate', label_de: 'Spendenbescheinigung', label_fr: 'Attestation de don', label_it: 'Attestato di donazione' },
  { code: 'supported_person_transfer', group_key: 'deductions', sort_order: 140, label_en: 'Support payments to a dependent person', label_de: 'Unterstützungsleistungen an bedürftige Person', label_fr: 'Soutien à une personne dans le besoin', label_it: 'Sostegno a persona bisognosa' },
  { code: 'bank_securities_crypto_statement', group_key: 'assets', sort_order: 150, label_en: 'Bank, securities & crypto statement', label_de: 'Bank-, Wertschriften- und Krypto-Verzeichnis', label_fr: 'Relevé bancaire, titres et cryptomonnaies', label_it: 'Estratto conto banca, titoli e crypto' },
  { code: 'pension_fund_statement', group_key: 'other', sort_order: 160, label_en: 'Pension fund statement', label_de: 'Pensionskassenausweis', label_fr: 'Certificat de la caisse de pension', label_it: 'Attestato cassa pensione' },
  { code: 'inheritance_gift_lpp_payment', group_key: 'other', sort_order: 170, label_en: 'Inheritance, gift or pension lump-sum payment', label_de: 'Erbschaft, Schenkung oder Kapitalauszahlung Vorsorge', label_fr: 'Succession, donation ou versement en capital LPP', label_it: 'Successione, donazione o versamento in capitale LPP' },
  { code: 'property_tax_value', group_key: 'property', sort_order: 180, label_en: 'Property tax value statement', label_de: 'Steuerwert Liegenschaft', label_fr: "Valeur fiscale de l'immeuble", label_it: 'Valore fiscale immobile' },
  { code: 'rental_contract_zug', group_key: 'property', sort_order: 190, label_en: 'Zug rental contract', label_de: 'Mietvertrag Zug', label_fr: 'Contrat de bail Zoug', label_it: 'Contratto di locazione Zugo' },
  { code: 'pension_buyback', group_key: 'deductions', sort_order: 95, label_en: 'Pension fund buy-in (Einkauf)', label_de: 'Einkauf in die Pensionskasse', label_fr: 'Rachat de la caisse de pension', label_it: 'Riscatto LPP' },
  { code: 'pension_capital_withdrawal', group_key: 'other', sort_order: 172, label_en: 'Pension capital withdrawal', label_de: 'Kapitalauszahlung Vorsorge', label_fr: 'Versement en capital de prévoyance', label_it: 'Prelievo in capitale da previdenza' },
  { code: 'life_insurance_policy', group_key: 'assets', sort_order: 152, label_en: 'Life/annuity insurance with surrender value', label_de: 'Lebens-/Rentenversicherung mit Rückkaufswert', label_fr: 'Assurance vie/rente avec valeur de rachat', label_it: 'Assicurazione vita/rendita con valore di riscatto' },
  { code: 'disability_costs', group_key: 'deductions', sort_order: 122, label_en: 'Disability-related costs', label_de: 'Behinderungsbedingte Kosten', label_fr: 'Frais liés au handicap', label_it: 'Spese legate a disabilità' },
  { code: 'training_costs', group_key: 'deductions', sort_order: 105, label_en: 'Training / continuing education costs', label_de: 'Aus- und Weiterbildungskosten', label_fr: 'Frais de formation et de perfectionnement', label_it: 'Spese di formazione e perfezionamento' },
  { code: 'private_vehicle', group_key: 'assets', sort_order: 153, label_en: 'Private vehicle', label_de: 'Privatfahrzeug', label_fr: 'Véhicule privé', label_it: 'Veicolo privato' },
  { code: 'property_sale', group_key: 'other', sort_order: 173, label_en: 'Real estate sale', label_de: 'Grundstückgewinn (Verkauf einer Liegenschaft)', label_fr: 'Vente immobilière', label_it: 'Vendita immobiliare' }
].map((item) => ({ id: item.code, active: true, ...item }))

// Mirrors category_field_definitions, seeded in
// supabase/migrations/20260101000009_seed_category_field_definitions.sql.
export const CATEGORY_FIELD_DEFINITIONS = [
  { category_code: 'current_tax_sheet', field_key: 'full_name', field_label: 'Full name', value_type: 'text', sort_order: 10 },
  { category_code: 'current_tax_sheet', field_key: 'date_of_birth', field_label: 'Date of birth', value_type: 'date', sort_order: 20 },
  { category_code: 'current_tax_sheet', field_key: 'marital_status', field_label: 'Marital status', value_type: 'text', sort_order: 30 },
  { category_code: 'current_tax_sheet', field_key: 'canton', field_label: 'Canton', value_type: 'text', sort_order: 40 },
  { category_code: 'current_tax_sheet', field_key: 'municipality', field_label: 'Municipality', value_type: 'text', sort_order: 50 },
  { category_code: 'current_tax_sheet', field_key: 'zip', field_label: 'ZIP code', value_type: 'text', sort_order: 60 },
  { category_code: 'current_tax_sheet', field_key: 'children_count', field_label: 'Number of children', value_type: 'numeric', sort_order: 70 },
  { category_code: 'current_tax_sheet', field_key: 'religious_affiliation', field_label: 'Religious affiliation', value_type: 'text', sort_order: 80 },
  { category_code: 'current_tax_sheet', field_key: 'partner_full_name', field_label: "Partner's full name", value_type: 'text', sort_order: 90 },
  { category_code: 'current_tax_sheet', field_key: 'partner_date_of_birth', field_label: "Partner's date of birth", value_type: 'date', sort_order: 100 },
  { category_code: 'current_tax_sheet', field_key: 'partner_religious_affiliation', field_label: "Partner's religious affiliation", value_type: 'text', sort_order: 110 },

  { category_code: 'previous_tax_return', field_key: 'tax_year', field_label: 'Tax year', value_type: 'numeric', sort_order: 10 },
  { category_code: 'previous_tax_return', field_key: 'previous_taxable_income', field_label: 'Previous taxable income', value_type: 'numeric', sort_order: 20 },
  { category_code: 'previous_tax_return', field_key: 'previous_taxable_wealth', field_label: 'Previous taxable wealth', value_type: 'numeric', sort_order: 30 },

  { category_code: 'previous_tax_assessment', field_key: 'assessment_date', field_label: 'Assessment date', value_type: 'date', sort_order: 10 },
  { category_code: 'previous_tax_assessment', field_key: 'assessed_taxable_income', field_label: 'Assessed taxable income', value_type: 'numeric', sort_order: 20 },
  { category_code: 'previous_tax_assessment', field_key: 'assessed_taxable_wealth', field_label: 'Assessed taxable wealth', value_type: 'numeric', sort_order: 30 },

  { category_code: 'salary_statement', field_key: 'employer_name', field_label: 'Employer name', value_type: 'text', sort_order: 10 },
  { category_code: 'salary_statement', field_key: 'gross_salary', field_label: 'Gross salary', value_type: 'numeric', sort_order: 20 },
  { category_code: 'salary_statement', field_key: 'net_salary', field_label: 'Net salary', value_type: 'numeric', sort_order: 30 },
  { category_code: 'salary_statement', field_key: 'withholding_tax', field_label: 'Withholding tax', value_type: 'numeric', sort_order: 40 },
  { category_code: 'salary_statement', field_key: 'ahv_contributions', field_label: 'AHV contributions', value_type: 'numeric', sort_order: 50 },
  { category_code: 'salary_statement', field_key: 'pension_fund_contributions', field_label: 'Pension fund contributions', value_type: 'numeric', sort_order: 60 },
  { category_code: 'salary_statement', field_key: 'expense_allowances', field_label: 'Expense allowances', value_type: 'numeric', sort_order: 70 },
  { category_code: 'salary_statement', field_key: 'employment_period_from', field_label: 'Employment period from', value_type: 'date', sort_order: 80 },
  { category_code: 'salary_statement', field_key: 'employment_period_to', field_label: 'Employment period to', value_type: 'date', sort_order: 90 },

  { category_code: 'self_employed_income_statement', field_key: 'business_name', field_label: 'Business name', value_type: 'text', sort_order: 10 },
  { category_code: 'self_employed_income_statement', field_key: 'revenue', field_label: 'Revenue', value_type: 'numeric', sort_order: 20 },
  { category_code: 'self_employed_income_statement', field_key: 'expenses', field_label: 'Expenses', value_type: 'numeric', sort_order: 30 },
  { category_code: 'self_employed_income_statement', field_key: 'net_profit', field_label: 'Net profit', value_type: 'numeric', sort_order: 40 },
  { category_code: 'self_employed_income_statement', field_key: 'fiscal_year', field_label: 'Fiscal year', value_type: 'text', sort_order: 50 },

  { category_code: 'alimony_received', field_key: 'payer_name', field_label: 'Payer name', value_type: 'text', sort_order: 10 },
  { category_code: 'alimony_received', field_key: 'annual_amount', field_label: 'Annual amount', value_type: 'numeric', sort_order: 20 },
  { category_code: 'alimony_received', field_key: 'type', field_label: 'Type', value_type: 'text', sort_order: 30 },

  { category_code: 'alimony_paid', field_key: 'recipient_name', field_label: 'Recipient name', value_type: 'text', sort_order: 10 },
  { category_code: 'alimony_paid', field_key: 'annual_amount', field_label: 'Annual amount', value_type: 'numeric', sort_order: 20 },
  { category_code: 'alimony_paid', field_key: 'type', field_label: 'Type', value_type: 'text', sort_order: 30 },

  { category_code: 'childcare_costs', field_key: 'child_name', field_label: 'Child name', value_type: 'text', sort_order: 10 },
  { category_code: 'childcare_costs', field_key: 'provider_name', field_label: 'Provider name', value_type: 'text', sort_order: 20 },
  { category_code: 'childcare_costs', field_key: 'annual_amount', field_label: 'Annual amount', value_type: 'numeric', sort_order: 30 },

  { category_code: 'debt_certificate', field_key: 'creditor_name', field_label: 'Creditor name', value_type: 'text', sort_order: 10 },
  { category_code: 'debt_certificate', field_key: 'debt_type', field_label: 'Debt type', value_type: 'text', sort_order: 20 },
  { category_code: 'debt_certificate', field_key: 'debt_balance', field_label: 'Debt balance', value_type: 'numeric', sort_order: 30 },
  { category_code: 'debt_certificate', field_key: 'annual_interest_paid', field_label: 'Annual interest paid', value_type: 'numeric', sort_order: 40 },
  { category_code: 'debt_certificate', field_key: 'annual_amortization', field_label: 'Annual amortization (principal repayment)', value_type: 'numeric', sort_order: 50 },

  { category_code: 'pillar_3a_certificate', field_key: 'institution_name', field_label: 'Institution name', value_type: 'text', sort_order: 10 },
  { category_code: 'pillar_3a_certificate', field_key: 'policy_number', field_label: 'Policy number', value_type: 'text', sort_order: 20 },
  { category_code: 'pillar_3a_certificate', field_key: 'annual_contribution', field_label: 'Annual contribution', value_type: 'numeric', sort_order: 30 },

  { category_code: 'health_insurance_policy', field_key: 'insurer_name', field_label: 'Insurer name', value_type: 'text', sort_order: 10 },
  { category_code: 'health_insurance_policy', field_key: 'insured_persons_count', field_label: 'Insured persons count', value_type: 'numeric', sort_order: 20 },
  { category_code: 'health_insurance_policy', field_key: 'annual_premium', field_label: 'Annual premium', value_type: 'numeric', sort_order: 30 },

  { category_code: 'medical_costs', field_key: 'description', field_label: 'Description', value_type: 'text', sort_order: 10 },
  { category_code: 'medical_costs', field_key: 'insurance_reimbursement', field_label: 'Insurance reimbursement received', value_type: 'numeric', sort_order: 15 },
  { category_code: 'medical_costs', field_key: 'total_amount', field_label: 'Total amount', value_type: 'numeric', sort_order: 20 },

  { category_code: 'donation_certificate', field_key: 'recipient_organization', field_label: 'Recipient organization', value_type: 'text', sort_order: 10 },
  { category_code: 'donation_certificate', field_key: 'annual_amount', field_label: 'Annual amount', value_type: 'numeric', sort_order: 20 },
  { category_code: 'donation_certificate', field_key: 'has_consideration', field_label: 'Consideration/benefit received in return (yes/no)', value_type: 'text', sort_order: 30 },

  { category_code: 'supported_person_transfer', field_key: 'supported_person_name', field_label: 'Supported person name', value_type: 'text', sort_order: 10 },
  { category_code: 'supported_person_transfer', field_key: 'relationship', field_label: 'Relationship', value_type: 'text', sort_order: 20 },
  { category_code: 'supported_person_transfer', field_key: 'annual_amount', field_label: 'Annual amount', value_type: 'numeric', sort_order: 30 },

  { category_code: 'bank_securities_crypto_statement', field_key: 'institution_name', field_label: 'Institution name', value_type: 'text', sort_order: 10 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'currency', field_label: 'Currency', value_type: 'text', sort_order: 15 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_type', field_label: 'Account type', value_type: 'text', sort_order: 20 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_balance_31_12', field_label: 'Account balance (31.12)', value_type: 'numeric', sort_order: 30 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'interest_income', field_label: 'Interest income', value_type: 'numeric', sort_order: 40 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'dividend_income', field_label: 'Dividend income', value_type: 'numeric', sort_order: 50 },

  { category_code: 'pension_fund_statement', field_key: 'institution_name', field_label: 'Institution name', value_type: 'text', sort_order: 10 },
  { category_code: 'pension_fund_statement', field_key: 'accumulated_capital', field_label: 'Accumulated capital', value_type: 'numeric', sort_order: 20 },

  { category_code: 'inheritance_gift_lpp_payment', field_key: 'type', field_label: 'Type', value_type: 'text', sort_order: 10 },
  { category_code: 'inheritance_gift_lpp_payment', field_key: 'amount', field_label: 'Amount', value_type: 'numeric', sort_order: 20 },
  { category_code: 'inheritance_gift_lpp_payment', field_key: 'date_received', field_label: 'Date received', value_type: 'date', sort_order: 30 },

  { category_code: 'property_tax_value', field_key: 'property_address', field_label: 'Property address', value_type: 'text', sort_order: 10 },
  { category_code: 'property_tax_value', field_key: 'tax_value', field_label: 'Tax value', value_type: 'numeric', sort_order: 20 },
  { category_code: 'property_tax_value', field_key: 'imputed_rental_value', field_label: 'Imputed rental value', value_type: 'numeric', sort_order: 30 },
  { category_code: 'property_tax_value', field_key: 'annual_rental_income', field_label: 'Annual rental income received', value_type: 'numeric', sort_order: 35 },
  { category_code: 'property_tax_value', field_key: 'maintenance_costs', field_label: 'Maintenance costs', value_type: 'numeric', sort_order: 40 },

  { category_code: 'rental_contract_zug', field_key: 'property_address', field_label: 'Property address', value_type: 'text', sort_order: 10 },
  { category_code: 'rental_contract_zug', field_key: 'annual_rent', field_label: 'Annual rent', value_type: 'numeric', sort_order: 20 },

  { category_code: 'pension_buyback', field_key: 'institution_name', field_label: 'Institution name', value_type: 'text', sort_order: 10 },
  { category_code: 'pension_buyback', field_key: 'annual_amount', field_label: 'Annual amount', value_type: 'numeric', sort_order: 20 },

  { category_code: 'pension_capital_withdrawal', field_key: 'withdrawal_type', field_label: 'Withdrawal type (LPP / 3a / vested benefits / severance)', value_type: 'text', sort_order: 10 },
  { category_code: 'pension_capital_withdrawal', field_key: 'gross_amount', field_label: 'Gross amount', value_type: 'numeric', sort_order: 20 },
  { category_code: 'pension_capital_withdrawal', field_key: 'date_received', field_label: 'Date received', value_type: 'date', sort_order: 30 },

  { category_code: 'life_insurance_policy', field_key: 'insurer_name', field_label: 'Insurer name', value_type: 'text', sort_order: 10 },
  { category_code: 'life_insurance_policy', field_key: 'surrender_value', field_label: 'Surrender value (31.12)', value_type: 'numeric', sort_order: 20 },
  { category_code: 'life_insurance_policy', field_key: 'annual_premium', field_label: 'Annual premium', value_type: 'numeric', sort_order: 30 },

  { category_code: 'disability_costs', field_key: 'description', field_label: 'Description', value_type: 'text', sort_order: 10 },
  { category_code: 'disability_costs', field_key: 'annual_amount', field_label: 'Annual amount', value_type: 'numeric', sort_order: 20 },

  { category_code: 'training_costs', field_key: 'description', field_label: 'Description', value_type: 'text', sort_order: 10 },
  { category_code: 'training_costs', field_key: 'annual_amount', field_label: 'Annual amount', value_type: 'numeric', sort_order: 20 },

  { category_code: 'private_vehicle', field_key: 'description', field_label: 'Description (make/model)', value_type: 'text', sort_order: 10 },
  { category_code: 'private_vehicle', field_key: 'purchase_price', field_label: 'Purchase price', value_type: 'numeric', sort_order: 20 },
  { category_code: 'private_vehicle', field_key: 'purchase_year', field_label: 'Purchase year', value_type: 'numeric', sort_order: 30 },

  { category_code: 'property_sale', field_key: 'property_address', field_label: 'Property address', value_type: 'text', sort_order: 10 },
  { category_code: 'property_sale', field_key: 'sale_gain_amount', field_label: 'Capital gain on sale', value_type: 'numeric', sort_order: 20 },
  { category_code: 'property_sale', field_key: 'sale_date', field_label: 'Sale date', value_type: 'date', sort_order: 30 },

  { category_code: 'salary_statement', field_key: 'code_f_present', field_label: 'Code F present (free commute provided by employer)', value_type: 'text', sort_order: 100 },
  { category_code: 'salary_statement', field_key: 'code_g_present', field_label: 'Code G present (subsidized meals)', value_type: 'text', sort_order: 110 },
  { category_code: 'salary_statement', field_key: 'annual_commute_cost', field_label: 'Annual commute cost claimed', value_type: 'numeric', sort_order: 120 },
  { category_code: 'salary_statement', field_key: 'annual_meal_costs', field_label: 'Annual extra meal costs claimed', value_type: 'numeric', sort_order: 130 },

  { category_code: 'bank_securities_crypto_statement', field_key: 'capital_gain_loss', field_label: 'Capital gain/loss on sale (not taxable — reference only)', value_type: 'numeric', sort_order: 55 },

  { category_code: 'alimony_paid', field_key: 'beneficiary_type', field_label: 'Beneficiary (ex-spouse / child)', value_type: 'text', sort_order: 40 },
  { category_code: 'alimony_paid', field_key: 'beneficiary_is_minor', field_label: 'Beneficiary still a minor (yes/no)', value_type: 'text', sort_order: 50 },
  { category_code: 'alimony_received', field_key: 'beneficiary_type', field_label: 'Beneficiary (ex-spouse / child)', value_type: 'text', sort_order: 40 },
  { category_code: 'alimony_received', field_key: 'beneficiary_is_minor', field_label: 'Beneficiary still a minor (yes/no)', value_type: 'text', sort_order: 50 }
].map((item, index) => ({ id: `field-${index}`, required: false, ...item }))

export const PRICING_ITEMS = [
  { code: 'base_single', kind: 'base', sort_order: 10, price: 240, unit: null, quantity_from: null, label_en: 'Single', label_fr: 'Célibataire', label_de: 'Alleinstehend', label_it: 'Celibe/nubile' },
  { code: 'base_married', kind: 'base', sort_order: 20, price: 320, unit: null, quantity_from: null, label_en: 'Married', label_fr: 'Marié', label_de: 'Verheiratet', label_it: 'Coniugato/a' },
  { code: 'property', kind: 'per_unit', sort_order: 30, price: 80, unit: 'property', quantity_from: null, label_en: 'Per property in Switzerland or abroad', label_fr: "Par immeuble en Suisse ou à l'étranger", label_de: 'Pro Liegenschaft im In- oder Ausland', label_it: "Per immobile in Svizzera o all'estero" },
  { code: 'assets_10', kind: 'tier', sort_order: 40, price: 100, unit: 'asset_unit', quantity_from: 10, label_en: 'Asset statements from 10 units (accounts, crypto, stocks, etc.)', label_fr: 'Relevés bancaires de 10 unités', label_de: 'Vermögensausweise ab 10 Einheiten', label_it: 'Estratti patrimoniali da 10 unità' },
  { code: 'assets_20', kind: 'tier', sort_order: 50, price: 200, unit: 'asset_unit', quantity_from: 20, label_en: 'Asset statements from 20 units (accounts, crypto, stocks, etc.)', label_fr: 'Relevés bancaires de 20 unités', label_de: 'Vermögensausweise ab 20 Einheiten', label_it: 'Estratti patrimoniali da 20 unità' },
  { code: 'self_employed', kind: 'surcharge', sort_order: 60, price: 80, unit: null, quantity_from: null, label_en: 'Self-employed', label_fr: 'Travailleur indépendant', label_de: 'Selbständigerwerbend', label_it: 'Lavoratore indipendente' },
  { code: 'shareholding', kind: 'per_unit', sort_order: 70, price: 40, unit: 'shareholding', quantity_from: null, label_en: 'Per qualifying shareholding in a company', label_fr: 'Par participation qualifiée dans des sociétés', label_de: 'Pro qualifizierte Beteiligung', label_it: 'Per partecipazione qualificata' },
  { code: 'postal_delivery', kind: 'surcharge', sort_order: 80, price: 20, unit: null, quantity_from: null, label_en: 'Tax return sent by post', label_fr: 'Déclaration envoyée par courrier', label_de: 'Steuererklärung per Post', label_it: 'Dichiarazione inviata per posta' },
  { code: 'express', kind: 'surcharge', sort_order: 90, price: 150, unit: null, quantity_from: null, label_en: 'Express tax return', label_fr: 'Déclaration express', label_de: 'Express-Steuererklärung', label_it: 'Dichiarazione express' },
  { code: 'svc_retirement', kind: 'service', sort_order: 200, price: 0, label_en: 'Retirement planning', label_fr: 'Planification de la retraite', label_de: 'Pensionsplanung', label_it: 'Pianificazione pensionistica' },
  { code: 'svc_financial', kind: 'service', sort_order: 210, price: 0, label_en: 'Financial planning', label_fr: 'Planification financière', label_de: 'Finanzplanung', label_it: 'Pianificazione finanziaria' },
  { code: 'svc_insurance', kind: 'service', sort_order: 220, price: 0, label_en: 'Optimisation of insurances', label_fr: 'Optimisation des assurances', label_de: 'Versicherungsoptimierung', label_it: 'Ottimizzazione delle assicurazioni' },
  { code: 'svc_trading', kind: 'service', sort_order: 230, price: 0, label_en: 'Trading', label_fr: 'Trading', label_de: 'Trading', label_it: 'Trading' },
  { code: 'svc_abroad_re', kind: 'service', sort_order: 240, price: 0, label_en: 'Real estate investment abroad', label_fr: "Investissement immobilier à l'étranger", label_de: 'Immobilieninvestitionen im Ausland', label_it: "Investimenti immobiliari all'estero" },
  { code: 'svc_tax_advice', kind: 'service', sort_order: 250, price: 0, label_en: 'Tax advice', label_fr: 'Conseil fiscal', label_de: 'Steuerberatung', label_it: 'Consulenza fiscale' },
  { code: 'svc_investments', kind: 'service', sort_order: 260, price: 0, label_en: 'Investments', label_fr: 'Investissements', label_de: 'Anlagen', label_it: 'Investimenti' },
  { code: 'svc_brokerage', kind: 'service', sort_order: 270, price: 0, label_en: 'Real estate brokerage', label_fr: 'Courtage immobilier', label_de: 'Immobilienvermittlung', label_it: 'Intermediazione immobiliare' }
].map((item, index) => ({ id: `price-${index}`, app_id: 'hornung_crm', active: true, ...item }))

// A small representative sample (not the full real dataset, seeded in
// supabase/migrations/20260101000013_tax_parameters_data.sql) — just enough
// to preview the "Tax parameters" screen in demo mode.
export const TAX_PARAMETERS = [
  { scope: 'federal', canton_code: null, tax_year: 2026, parameter_key: 'pillar_3a_with_lpp', parameter_family: 'pillar_3a_with_lpp', parameter_label: '3° pilastro a, con LPP', value_numeric: 7258, value_type: 'fixed_amount', source_url: 'https://www.admin.ch', notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2026, parameter_key: 'pillar_3a_without_lpp', parameter_family: 'pillar_3a_without_lpp', parameter_label: '3° pilastro a, senza LPP', value_numeric: 36288, value_type: 'formula', source_url: 'https://www.admin.ch', notes: "20% del reddito netto da attività lucrativa, fino a un massimo di CHF 36'288.", last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'ZH', tax_year: 2026, parameter_key: 'childcare_costs', parameter_family: 'childcare_costs_cap', parameter_label: 'Custodia di terzi per i figli', value_numeric: 25000, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'ZH', tax_year: 2026, parameter_key: 'health_insurance_premium_single', parameter_family: 'health_insurance_premium_cap', parameter_label: 'Premio cassa malati (persona singola)', value_numeric: 2900, value_type: 'fixed_amount', source_url: null, notes: 'Persona singola — verificare per coniugati/con figli.', last_verified_at: null },
  { scope: 'federal', canton_code: null, tax_year: 2026, parameter_key: 'medical_costs_threshold', parameter_family: 'medical_costs_threshold_pct', parameter_label: 'Spese mediche', value_numeric: 5, value_type: 'percentage', source_url: null, notes: 'Soglia di deducibilità, non un tetto: deducibile solo la parte eccedente il 5% del reddito netto.', last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2026, parameter_key: 'medical_costs_threshold', parameter_family: 'medical_costs_threshold_pct', parameter_label: 'Spese mediche', value_numeric: 2, value_type: 'percentage', source_url: 'https://www.estv2.admin.ch/stp/kb/vs-fr.pdf', notes: 'Valore 2025 secondo la scheda fiscale AFC Vallese — da riverificare per il 2026.', last_verified_at: null },
  { scope: 'federal', canton_code: null, tax_year: 2026, parameter_key: 'donations_cap', parameter_family: 'donation_cap_pct', parameter_label: 'Donazioni', value_numeric: 20, value_type: 'percentage', source_url: null, notes: 'Tetto massimo deducibile: 20% del reddito netto.', last_verified_at: new Date().toISOString() },

  // --- tax_year 2025 — mirrors production migration 23 (phase 2) ---------
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'pillar_3a_with_lpp', parameter_family: 'pillar_3a_with_lpp', parameter_label: '3° pilastro a, con LPP', value_numeric: 7258, value_type: 'fixed_amount', source_url: 'https://www.admin.ch', notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'pillar_3a_without_lpp', parameter_family: 'pillar_3a_without_lpp', parameter_label: '3° pilastro a, senza LPP', value_numeric: 36288, value_type: 'formula', source_url: 'https://www.admin.ch', notes: "20% del reddito netto da attività lucrativa, fino a un massimo di CHF 36'288.", last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'medical_costs_threshold', parameter_family: 'medical_costs_threshold_pct', parameter_label: 'Spese mediche', value_numeric: 5, value_type: 'percentage', source_url: null, notes: 'Soglia di deducibilità, non un tetto: calcolata dopo tutte le altre deduzioni.', last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'donations_cap', parameter_family: 'donation_cap_pct', parameter_label: 'Donazioni', value_numeric: 20, value_type: 'percentage', source_url: null, notes: 'Tetto massimo deducibile: 20% del reddito netto.', last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'debt_interest_deduction', parameter_family: 'debt_interest_extra_allowance', parameter_label: 'Interessi passivi su debiti', value_numeric: 50000, value_type: 'formula', source_url: null, notes: "Deducibili fino a un importo pari al reddito da patrimonio più CHF 50'000.", last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'childcare_costs', parameter_family: 'childcare_costs_cap', parameter_label: 'Custodia di terzi per i figli', value_numeric: 25800, value_type: 'fixed_amount', source_url: 'https://www.estv.admin.ch', notes: 'Valore 2025 verificato via Steuermäppchen AFC.', last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'professional_expenses_pct', parameter_family: 'professional_expenses_pct', parameter_label: 'Spese professionali forfait (%)', value_numeric: 3, value_type: 'percentage', source_url: null, notes: 'Federale e Vallese uguali.', last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'professional_expenses_min', parameter_family: 'professional_expenses_min', parameter_label: 'Spese professionali forfait (minimo)', value_numeric: 2000, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'professional_expenses_max', parameter_family: 'professional_expenses_max', parameter_label: 'Spese professionali forfait (massimo)', value_numeric: 4000, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'commute_costs_cap', parameter_family: 'commute_costs_cap', parameter_label: 'Spese di trasporto casa-lavoro', value_numeric: 3300, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'meal_costs_cap', parameter_family: 'meal_costs_cap', parameter_label: 'Pasti fuori casa', value_numeric: 3200, value_type: 'fixed_amount', source_url: null, notes: 'Dimezzato se il datore sovvenziona i pasti (codice G).', last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'training_costs_cap', parameter_family: 'training_costs_cap', parameter_label: 'Formazione e perfezionamento', value_numeric: 13000, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'insurance_premium_cap_single', parameter_family: 'insurance_premium_cap_single', parameter_label: 'Premi assicurativi (persona singola)', value_numeric: 1800, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'insurance_premium_cap_married', parameter_family: 'insurance_premium_cap_married', parameter_label: 'Premi assicurativi (coniugi)', value_numeric: 3700, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'insurance_premium_child_increment', parameter_family: 'insurance_premium_child_increment', parameter_label: 'Premi assicurativi (supplemento per figlio)', value_numeric: 700, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'donation_min_amount', parameter_family: 'donation_min_amount', parameter_label: 'Donazioni (minimo deducibile)', value_numeric: 100, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'child_social_deduction', parameter_family: 'child_deduction_flat', parameter_label: 'Deduzione per figlio', value_numeric: 6800, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'married_social_deduction', parameter_family: 'married_deduction_flat', parameter_label: 'Deduzione per coniugati', value_numeric: 2800, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'dependent_support_cap', parameter_family: 'dependent_support_cap', parameter_label: 'Persone a carico', value_numeric: 6800, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'two_income_deduction_pct', parameter_family: 'two_income_deduction_pct', parameter_label: 'Deduzione doppio reddito (%)', value_numeric: 50, value_type: 'percentage', source_url: null, notes: 'Non calcolato automaticamente.', last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'two_income_deduction_min', parameter_family: 'two_income_deduction_min', parameter_label: 'Deduzione doppio reddito (minimo)', value_numeric: 8600, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'federal', canton_code: null, tax_year: 2025, parameter_key: 'two_income_deduction_max', parameter_family: 'two_income_deduction_max', parameter_label: 'Deduzione doppio reddito (massimo)', value_numeric: 14100, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },

  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'medical_costs_threshold', parameter_family: 'medical_costs_threshold_pct', parameter_label: 'Spese mediche', value_numeric: 2, value_type: 'percentage', source_url: 'https://www.estv2.admin.ch/stp/kb/vs-fr.pdf', notes: 'Scheda fiscale AFC Vallese 2025.', last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'commute_costs_cap', parameter_family: 'commute_costs_cap', parameter_label: 'Spese di trasporto casa-lavoro', value_numeric: null, value_type: 'no_cap', source_url: null, notes: 'Nessun tetto cantonale in Vallese.', last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'training_costs_cap', parameter_family: 'training_costs_cap', parameter_label: 'Formazione e perfezionamento', value_numeric: 12550, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'insurance_premium_cap_single', parameter_family: 'insurance_premium_cap_single', parameter_label: 'Premi assicurativi (persona singola)', value_numeric: 3620, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'insurance_premium_cap_married', parameter_family: 'insurance_premium_cap_married', parameter_label: 'Premi assicurativi (coniugi)', value_numeric: 7240, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'insurance_premium_child_increment', parameter_family: 'insurance_premium_child_increment', parameter_label: 'Premi assicurativi (supplemento per figlio)', value_numeric: 1130, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'childcare_costs', parameter_family: 'childcare_costs_cap', parameter_label: 'Custodia di terzi per i figli', value_numeric: 10000, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'child_deduction_0_6', parameter_family: 'child_deduction_0_6', parameter_label: 'Deduzione per figlio (0-6 anni)', value_numeric: 7860, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'child_deduction_6_16', parameter_family: 'child_deduction_6_16', parameter_label: 'Deduzione per figlio (6-16 anni)', value_numeric: 8940, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'child_deduction_16_plus', parameter_family: 'child_deduction_16_plus', parameter_label: 'Deduzione per figlio (16+ in formazione)', value_numeric: 11930, value_type: 'fixed_amount', source_url: null, notes: null, last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'dependent_support_cap', parameter_family: 'dependent_support_cap', parameter_label: 'Persone a carico', value_numeric: 2510, value_type: 'fixed_amount', source_url: null, notes: "Varia CHF 2'510–6'030 in base al contributo — usato il minimo come stima prudente.", last_verified_at: null },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'two_income_deduction_vs_fixed', parameter_family: 'two_income_deduction_vs_fixed', parameter_label: 'Deduzione doppio reddito (Vallese)', value_numeric: 6290, value_type: 'fixed_amount', source_url: null, notes: 'Non calcolato automaticamente.', last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'wealth_exempt_single', parameter_family: 'wealth_exempt_single', parameter_label: 'Importo esente sulla sostanza (persona singola)', value_numeric: 45000, value_type: 'fixed_amount', source_url: null, notes: 'Nessun importo esente a livello federale.', last_verified_at: new Date().toISOString() },
  { scope: 'cantonal', canton_code: 'VS', tax_year: 2025, parameter_key: 'wealth_exempt_married', parameter_family: 'wealth_exempt_married', parameter_label: 'Importo esente sulla sostanza (coniugi)', value_numeric: 90000, value_type: 'fixed_amount', source_url: null, notes: 'Nessun importo esente a livello federale.', last_verified_at: new Date().toISOString() }
].map((item, index) => ({ id: `param-${index}`, ...item }))

// Mirrors the full rule set seeded in
// supabase/migrations/20260101000014_field_calculation_rules.sql — one row
// per (category_code, field_key), so demo mode exercises exactly the same
// income/deduction/wealth mapping as production instead of a partial
// preview (fields left out here would silently default to contribution_type
// 'none', which is fine for a screen preview but not for actually testing
// the calculation engine end to end).
export const FIELD_CALCULATION_RULES = [
  // current_tax_sheet — basic data, not part of the calculation
  { category_code: 'current_tax_sheet', field_key: 'full_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'date_of_birth', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'marital_status', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'canton', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'municipality', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'zip', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'children_count', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'religious_affiliation', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'partner_full_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'partner_date_of_birth', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'current_tax_sheet', field_key: 'partner_religious_affiliation', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // previous_tax_return / previous_tax_assessment — reference only
  { category_code: 'previous_tax_return', field_key: 'tax_year', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'previous_tax_return', field_key: 'previous_taxable_income', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'previous_tax_return', field_key: 'previous_taxable_wealth', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'previous_tax_assessment', field_key: 'assessment_date', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'previous_tax_assessment', field_key: 'assessed_taxable_income', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'previous_tax_assessment', field_key: 'assessed_taxable_wealth', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // salary_statement
  { category_code: 'salary_statement', field_key: 'employer_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  // Taxable income is the net salary (gross minus mandatory AHV/IV/ALV/LPP
  // contributions, already netted out on the certificate) — gross_salary
  // stays extracted/visible for reference, it just doesn't count itself.
  { category_code: 'salary_statement', field_key: 'gross_salary', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'net_salary', contribution_type: 'income_plus', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'withholding_tax', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'ahv_contributions', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'pension_fund_contributions', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'expense_allowances', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'employment_period_from', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'employment_period_to', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'code_f_present', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'salary_statement', field_key: 'code_g_present', contribution_type: 'none', cap_parameter_family: null, notes: null },
  {
    category_code: 'salary_statement',
    field_key: 'annual_commute_cost',
    contribution_type: 'income_minus',
    cap_parameter_family: 'commute_costs_cap',
    notes: 'Azzerato se il codice F è presente (trasporto casa-lavoro gratuito fornito dal datore).'
  },
  {
    category_code: 'salary_statement',
    field_key: 'annual_meal_costs',
    contribution_type: 'income_minus',
    cap_parameter_family: 'meal_costs_cap',
    notes: 'Tetto dimezzato se il codice G è presente (pasti sovvenzionati dal datore).'
  },

  // self_employed_income_statement
  { category_code: 'self_employed_income_statement', field_key: 'business_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'self_employed_income_statement', field_key: 'revenue', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'self_employed_income_statement', field_key: 'expenses', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'self_employed_income_statement', field_key: 'net_profit', contribution_type: 'income_plus', cap_parameter_family: null, notes: null },
  { category_code: 'self_employed_income_statement', field_key: 'fiscal_year', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // alimony_received / alimony_paid
  { category_code: 'alimony_received', field_key: 'payer_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_received', field_key: 'annual_amount', contribution_type: 'income_plus', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_received', field_key: 'type', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_received', field_key: 'beneficiary_type', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_received', field_key: 'beneficiary_is_minor', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_paid', field_key: 'recipient_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_paid', field_key: 'annual_amount', contribution_type: 'income_minus', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_paid', field_key: 'type', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_paid', field_key: 'beneficiary_type', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'alimony_paid', field_key: 'beneficiary_is_minor', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // childcare_costs
  { category_code: 'childcare_costs', field_key: 'child_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'childcare_costs', field_key: 'provider_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'childcare_costs', field_key: 'annual_amount', contribution_type: 'income_minus', cap_parameter_family: 'childcare_costs_cap', notes: null },

  // debt_certificate — the balance is a wealth item, only the interest is an income deduction
  { category_code: 'debt_certificate', field_key: 'creditor_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'debt_certificate', field_key: 'debt_type', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'debt_certificate', field_key: 'debt_balance', contribution_type: 'wealth_minus', cap_parameter_family: null, notes: null },
  // Amortization is a repayment of capital, not a cost — never deductible,
  // unlike the interest paid on the same debt.
  {
    category_code: 'debt_certificate',
    field_key: 'annual_amortization',
    contribution_type: 'none',
    cap_parameter_family: null,
    notes: 'Ammortamento del mutuo: pagamento patrimoniale, mai deducibile dal reddito.'
  },
  {
    category_code: 'debt_certificate',
    field_key: 'annual_interest_paid',
    contribution_type: 'income_minus',
    cap_parameter_family: 'debt_interest_extra_allowance',
    notes: "Il tetto non è un importo fisso: è pari al reddito da patrimonio del cliente più l'importo del parametro."
  },

  // pillar_3a_certificate
  { category_code: 'pillar_3a_certificate', field_key: 'institution_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'pillar_3a_certificate', field_key: 'policy_number', contribution_type: 'none', cap_parameter_family: null, notes: null },
  {
    category_code: 'pillar_3a_certificate',
    field_key: 'annual_contribution',
    contribution_type: 'income_minus',
    cap_parameter_family: null,
    notes: 'Il tetto dipende dalla situazione previdenziale del cliente: usare il parametro "3° pilastro a, con LPP" se affiliato a una cassa pensione, altrimenti "3° pilastro a, senza LPP".'
  },

  // health_insurance_policy
  { category_code: 'health_insurance_policy', field_key: 'insurer_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'health_insurance_policy', field_key: 'insured_persons_count', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'health_insurance_policy', field_key: 'annual_premium', contribution_type: 'income_minus', cap_parameter_family: 'insurance_premium_pool', notes: null },

  // medical_costs
  { category_code: 'medical_costs', field_key: 'description', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'medical_costs', field_key: 'insurance_reimbursement', contribution_type: 'none', cap_parameter_family: null, notes: null },
  {
    category_code: 'medical_costs',
    field_key: 'total_amount',
    contribution_type: 'income_minus',
    cap_parameter_family: 'medical_costs_threshold_pct',
    notes: "È una soglia, non un tetto: deducibile solo l'importo che eccede la percentuale del reddito netto."
  },

  // donation_certificate
  { category_code: 'donation_certificate', field_key: 'recipient_organization', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'donation_certificate', field_key: 'annual_amount', contribution_type: 'income_minus', cap_parameter_family: 'donation_cap_pct', notes: null },
  { category_code: 'donation_certificate', field_key: 'has_consideration', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // supported_person_transfer
  { category_code: 'supported_person_transfer', field_key: 'supported_person_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'supported_person_transfer', field_key: 'relationship', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'supported_person_transfer', field_key: 'annual_amount', contribution_type: 'income_minus', cap_parameter_family: 'dependent_support_cap', notes: null },

  // bank_securities_crypto_statement
  { category_code: 'bank_securities_crypto_statement', field_key: 'institution_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'bank_securities_crypto_statement', field_key: 'currency', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_type', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_balance_31_12', contribution_type: 'wealth_plus', cap_parameter_family: null, notes: null },
  { category_code: 'bank_securities_crypto_statement', field_key: 'interest_income', contribution_type: 'income_plus', cap_parameter_family: null, notes: null },
  { category_code: 'bank_securities_crypto_statement', field_key: 'dividend_income', contribution_type: 'income_plus', cap_parameter_family: null, notes: null },
  {
    category_code: 'bank_securities_crypto_statement',
    field_key: 'capital_gain_loss',
    contribution_type: 'none',
    cap_parameter_family: null,
    notes: 'Plusvalenza su vendita di titoli/crypto nella sostanza privata: esente da imposta, estratta solo per completezza documentale.'
  },

  // pension_fund_statement — informational, not part of the calculation
  { category_code: 'pension_fund_statement', field_key: 'institution_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'pension_fund_statement', field_key: 'accumulated_capital', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // inheritance_gift_lpp_payment — taxed separately, shown flagged (not "none" — it must still be visible)
  { category_code: 'inheritance_gift_lpp_payment', field_key: 'type', contribution_type: 'none', cap_parameter_family: null, notes: null },
  {
    category_code: 'inheritance_gift_lpp_payment',
    field_key: 'amount',
    contribution_type: 'wealth_plus',
    cap_parameter_family: null,
    notes: 'Eredità, donazione o capitale previdenza ricevuti: tassati separatamente — sempre esclusi dal calcolo ordinario e segnalati.'
  },
  { category_code: 'inheritance_gift_lpp_payment', field_key: 'date_received', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // pension_buyback
  { category_code: 'pension_buyback', field_key: 'institution_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'pension_buyback', field_key: 'annual_amount', contribution_type: 'income_minus', cap_parameter_family: null, notes: 'Riscatto LPP: deduzione integrale, distinta dal prelievo in capitale.' },

  // pension_capital_withdrawal — always shown flagged, taxed separately
  { category_code: 'pension_capital_withdrawal', field_key: 'withdrawal_type', contribution_type: 'none', cap_parameter_family: null, notes: null },
  {
    category_code: 'pension_capital_withdrawal',
    field_key: 'gross_amount',
    contribution_type: 'income_plus',
    cap_parameter_family: null,
    notes: 'Tassato separatamente (rendita al 1/5 della tariffa) — sempre escluso dal calcolo ordinario e segnalato.'
  },
  { category_code: 'pension_capital_withdrawal', field_key: 'date_received', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // life_insurance_policy — surrender value is wealth, premiums pool with health insurance
  { category_code: 'life_insurance_policy', field_key: 'insurer_name', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'life_insurance_policy', field_key: 'surrender_value', contribution_type: 'wealth_plus', cap_parameter_family: null, notes: null },
  {
    category_code: 'life_insurance_policy',
    field_key: 'annual_premium',
    contribution_type: 'income_minus',
    cap_parameter_family: 'insurance_premium_pool',
    notes: 'Premio raggruppato con quello della cassa malati sotto lo stesso tetto.'
  },

  // disability_costs — fully deductible, no threshold
  { category_code: 'disability_costs', field_key: 'description', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'disability_costs', field_key: 'annual_amount', contribution_type: 'income_minus', cap_parameter_family: null, notes: 'Deducibile per intero, senza soglia.' },

  // training_costs
  { category_code: 'training_costs', field_key: 'description', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'training_costs', field_key: 'annual_amount', contribution_type: 'income_minus', cap_parameter_family: 'training_costs_cap', notes: null },

  // private_vehicle — always shown flagged (no depreciation formula implemented)
  { category_code: 'private_vehicle', field_key: 'description', contribution_type: 'none', cap_parameter_family: null, notes: null },
  {
    category_code: 'private_vehicle',
    field_key: 'purchase_price',
    contribution_type: 'wealth_plus',
    cap_parameter_family: null,
    notes: 'Nessuna formula di ammortamento cantonale implementata: mostrato sempre come "da verificare".'
  },
  { category_code: 'private_vehicle', field_key: 'purchase_year', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // property_sale — always shown flagged, taxed separately
  { category_code: 'property_sale', field_key: 'property_address', contribution_type: 'none', cap_parameter_family: null, notes: null },
  {
    category_code: 'property_sale',
    field_key: 'sale_gain_amount',
    contribution_type: 'income_plus',
    cap_parameter_family: null,
    notes: 'Plusvalenza immobiliare: tassata separatamente — sempre esclusa e segnalata.'
  },
  { category_code: 'property_sale', field_key: 'sale_date', contribution_type: 'none', cap_parameter_family: null, notes: null },

  // property_tax_value — the tax value is wealth; rental value/maintenance are income items
  { category_code: 'property_tax_value', field_key: 'property_address', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'property_tax_value', field_key: 'tax_value', contribution_type: 'wealth_plus', cap_parameter_family: null, notes: null },
  { category_code: 'property_tax_value', field_key: 'imputed_rental_value', contribution_type: 'income_plus', cap_parameter_family: null, notes: null },
  // Rent actually received from letting the property to a third party —
  // distinct from imputed_rental_value (owner-occupied figurative income).
  { category_code: 'property_tax_value', field_key: 'annual_rental_income', contribution_type: 'income_plus', cap_parameter_family: null, notes: null },
  { category_code: 'property_tax_value', field_key: 'maintenance_costs', contribution_type: 'income_minus', cap_parameter_family: null, notes: null },

  // rental_contract_zug
  { category_code: 'rental_contract_zug', field_key: 'property_address', contribution_type: 'none', cap_parameter_family: null, notes: null },
  { category_code: 'rental_contract_zug', field_key: 'annual_rent', contribution_type: 'income_minus', cap_parameter_family: null, notes: null }
].map((item, index) => ({ id: `calcrule-${index}`, ...item }))
