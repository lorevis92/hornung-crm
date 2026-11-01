-- ===========================================================================
-- 05 — SEED DATA
-- Document catalogue + price list, taken from the Hornung Consulting
-- questionnaire and "Pricing / Prix" sheet.
-- ===========================================================================

insert into public.document_types (id, category, sort_order, label_en, label_de, label_fr, label_it, help_en) values
 ('current_tax_sheet','base',10,
  'Current tax sheet',
  'Aktuelles Steuerformular',
  'Feuille d''impôt actuelle',
  'Foglio d''imposta attuale',
  'The form/letter you received from the tax authority for this tax year.'),

 ('last_tax_return','base',20,
  'Copy of your last tax return',
  'Kopie der letzten Steuererklärung',
  'Copie de votre dernière déclaration d''impôt',
  'Copia dell''ultima dichiarazione d''imposta', null),

 ('last_tax_assessment','base',30,
  'Copy of your last tax assessment',
  'Kopie der letzten Steuerveranlagung',
  'Copie de votre dernière taxation',
  'Copia dell''ultima tassazione', null),

 ('salary_statement','income',40,
  'Salary statement (employees) / income and expense statement (self-employed)',
  'Lohnausweis / Einnahmen- und Ausgabenrechnung (Selbständige)',
  'Certificat de salaire / compte de résultat (indépendants)',
  'Certificato di salario / conto economico (indipendenti)',
  'One statement per employer for the tax year.'),

 ('alimony','income',50,
  'Alimony agreement and bank statements showing donor and recipient (incl. date of birth)',
  'Unterhaltsvereinbarung und Bankbelege mit Zahler und Empfänger (inkl. Geburtsdatum)',
  'Convention de pension alimentaire et relevés bancaires indiquant le débiteur et le bénéficiaire (avec date de naissance)',
  'Accordo di mantenimento ed estratti bancari con debitore e beneficiario (con data di nascita)', null),

 ('childcare_costs','deductions',60,
  'Third-party childcare costs (e.g. day care)',
  'Drittbetreuungskosten (z. B. Kita)',
  'Frais de garde par des tiers (p. ex. crèche)',
  'Costi di custodia di terzi (es. asilo nido)', null),

 ('debt_certificates','deductions',70,
  'Debt certificates as of 31.12 (credit cards, private loans, mortgages)',
  'Schuldenausweise per 31.12. (Kreditkarten, Privatdarlehen, Hypotheken)',
  'Attestations de dettes au 31.12 (cartes de crédit, prêts privés, hypothèques)',
  'Attestazioni dei debiti al 31.12 (carte di credito, prestiti privati, ipoteche)',
  'Leasing cannot be deducted in an individual tax return.'),

 ('pillar_3a','deductions',80,
  'Pillar 3a certificate / voluntary contributions to the pension fund (BVG)',
  'Bescheinigung Säule 3a / freiwillige Einkäufe in die Pensionskasse (BVG)',
  'Attestation pilier 3a / rachats volontaires à la caisse de pension (LPP)',
  'Attestazione pilastro 3a / riscatti volontari alla cassa pensione (LPP)', null),

 ('health_insurance','deductions',90,
  'Health insurance policy or yearly premium statement',
  'Krankenkassenpolice oder Jahresprämienbescheinigung',
  'Police d''assurance maladie ou attestation de primes annuelles',
  'Polizza della cassa malati o attestazione dei premi annuali', null),

 ('medical_costs','deductions',100,
  'Non-reimbursed medical costs and invoices',
  'Nicht rückerstattete Krankheitskosten und Rechnungen',
  'Frais médicaux non remboursés et factures',
  'Spese mediche non rimborsate e fatture', null),

 ('donations','deductions',110,
  'Certificate for voluntary donations',
  'Bescheinigung für freiwillige Zuwendungen',
  'Attestation pour dons volontaires',
  'Attestazione per donazioni volontarie', null),

 ('support_payments','deductions',120,
  'Bank transfers to a financially supported person (name, date of birth, address)',
  'Überweisungen an eine unterstützte Person (Name, Geburtsdatum, Adresse)',
  'Virements à une personne soutenue financièrement (nom, date de naissance, adresse)',
  'Bonifici a una persona sostenuta finanziariamente (nome, data di nascita, indirizzo)', null),

 ('bank_statements','assets',130,
  'Bank, crypto and securities statements as of 31.12 (Swiss and foreign), incl. custody accounts',
  'Bank-, Krypto- und Wertschriftenausweise per 31.12. (In- und Ausland), inkl. Depotauszüge',
  'Relevés bancaires, crypto et titres au 31.12 (Suisse et étranger), y c. comptes de dépôt',
  'Estratti bancari, crypto e titoli al 31.12 (Svizzera ed estero), inclusi conti deposito',
  'Count each account/wallet as one unit — the number of units affects the fee.'),

 ('pension_fund','assets',140,
  'Pension fund statement and/or vested benefits policies',
  'Pensionskassenausweis und/oder Freizügigkeitspolicen',
  'Certificat de caisse de pension et/ou polices de libre passage',
  'Certificato della cassa pensione e/o polizze di libero passaggio', null),

 ('inheritance_gift','assets',150,
  'Inheritance, gift, early withdrawal or BVG payment received in the tax year',
  'Erbschaft, Schenkung, Vorbezug oder BVG-Auszahlung im Steuerjahr',
  'Héritage, donation, versement anticipé ou prestation LPP reçus dans l''année fiscale',
  'Eredità, donazione, prelievo anticipato o prestazione LPP ricevuti nell''anno fiscale', null),

 ('property_tax_value','property',160,
  'Official tax value statement of Swiss properties',
  'Amtliche Steuerwertbescheinigung von Schweizer Liegenschaften',
  'Estimation fiscale officielle des immeubles suisses',
  'Stima fiscale ufficiale degli immobili svizzeri', null),

 ('rental_contract_zug','property',170,
  'Tenants in Canton Zug only: copy of the rental contract',
  'Nur Mieter im Kanton Zug: Kopie des Mietvertrags',
  'Locataires dans le canton de Zoug uniquement : copie du bail',
  'Solo inquilini nel Canton Zugo: copia del contratto di locazione', null),

 ('other','other',900,
  'Other document',
  'Weiteres Dokument',
  'Autre document',
  'Altro documento', null)
on conflict (id) do update set
  category   = excluded.category,
  sort_order = excluded.sort_order,
  label_en   = excluded.label_en,
  label_de   = excluded.label_de,
  label_fr   = excluded.label_fr,
  label_it   = excluded.label_it,
  help_en    = excluded.help_en;

-- ---------------------------------------------------------------------------
-- Price list ("Pricing / Prix", CHF)
-- ---------------------------------------------------------------------------
insert into public.pricing_items (app_id, code, kind, sort_order, price, quantity_from, unit, label_en, label_fr, label_de, label_it) values
 ('hornung_crm','base_single','base',10,240,null,null,
  'Single','Célibataire','Alleinstehend','Celibe/nubile'),
 ('hornung_crm','base_married','base',20,320,null,null,
  'Married','Marié','Verheiratet','Coniugato/a'),
 ('hornung_crm','property','per_unit',30,80,null,'property',
  'Per property in Switzerland or abroad','Par immeuble en Suisse ou à l''étranger',
  'Pro Liegenschaft im In- oder Ausland','Per immobile in Svizzera o all''estero'),
 ('hornung_crm','assets_10','tier',40,100,10,'asset_unit',
  'Asset statements from 10 units (accounts, crypto, stocks, etc.)',
  'Relevés bancaires de 10 unités (comptes, crypto, actions, etc.)',
  'Vermögensausweise ab 10 Einheiten (Konten, Krypto, Aktien usw.)',
  'Estratti patrimoniali da 10 unità (conti, crypto, azioni, ecc.)'),
 ('hornung_crm','assets_20','tier',50,200,20,'asset_unit',
  'Asset statements from 20 units (accounts, crypto, stocks, etc.)',
  'Relevés bancaires de 20 unités (comptes, crypto, actions, etc.)',
  'Vermögensausweise ab 20 Einheiten (Konten, Krypto, Aktien usw.)',
  'Estratti patrimoniali da 20 unità (conti, crypto, azioni, ecc.)'),
 ('hornung_crm','self_employed','surcharge',60,80,null,null,
  'Self-employed','Travailleur indépendant','Selbständigerwerbend','Lavoratore indipendente'),
 ('hornung_crm','shareholding','per_unit',70,40,null,'shareholding',
  'Per qualifying shareholding in a company','Par participation qualifiée dans des sociétés',
  'Pro qualifizierte Beteiligung an Gesellschaften','Per partecipazione qualificata in società'),
 ('hornung_crm','postal_delivery','surcharge',80,20,null,null,
  'Tax return sent by post','Déclaration envoyée par courrier',
  'Steuererklärung per Post','Dichiarazione inviata per posta'),
 ('hornung_crm','express','surcharge',90,150,null,null,
  'Express tax return','Déclaration express','Express-Steuererklärung','Dichiarazione express'),
 -- Further services: price on request
 ('hornung_crm','svc_retirement','service',200,0,null,null,
  'Retirement planning','Planification de la retraite','Pensionsplanung','Pianificazione pensionistica'),
 ('hornung_crm','svc_financial','service',210,0,null,null,
  'Financial planning','Planification financière','Finanzplanung','Pianificazione finanziaria'),
 ('hornung_crm','svc_insurance','service',220,0,null,null,
  'Optimisation of insurances','Optimisation des assurances','Versicherungsoptimierung','Ottimizzazione delle assicurazioni'),
 ('hornung_crm','svc_trading','service',230,0,null,null,
  'Trading','Trading','Trading','Trading'),
 ('hornung_crm','svc_abroad_re','service',240,0,null,null,
  'Real estate investment abroad','Investissement immobilier à l''étranger',
  'Immobilieninvestitionen im Ausland','Investimenti immobiliari all''estero'),
 ('hornung_crm','svc_tax_advice','service',250,0,null,null,
  'Tax advice','Conseil fiscal','Steuerberatung','Consulenza fiscale'),
 ('hornung_crm','svc_investments','service',260,0,null,null,
  'Investments','Investissements','Anlagen','Investimenti'),
 ('hornung_crm','svc_brokerage','service',270,0,null,null,
  'Real estate brokerage','Courtage immobilier','Immobilienvermittlung','Intermediazione immobiliare')
on conflict (app_id, code) do update set
  kind = excluded.kind, price = excluded.price, sort_order = excluded.sort_order,
  quantity_from = excluded.quantity_from, unit = excluded.unit,
  label_en = excluded.label_en, label_fr = excluded.label_fr,
  label_de = excluded.label_de, label_it = excluded.label_it;

-- ---------------------------------------------------------------------------
-- One-off helper: turn an existing account into the tax specialist.
-- Run it from the SQL editor after the specialist has signed up:
--     select public.promote_to_specialist('hornungconsulting@gmail.com');
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_specialist(p_email text)
returns text
language plpgsql security definer set search_path = public, auth
as $$
declare v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  if v_user_id is null then
    return 'No auth user found for ' || p_email || ' — sign up first, then run this again.';
  end if;

  insert into public.app_profiles (user_id, app_id, role, email, full_name)
  values (v_user_id, 'hornung_crm', 'specialist', p_email, split_part(p_email, '@', 1))
  on conflict (user_id, app_id) do update set role = 'specialist';

  return 'OK — ' || p_email || ' is now a specialist of hornung_crm.';
end;
$$;

revoke all on function public.promote_to_specialist(text) from public, anon, authenticated;
grant execute on function public.promote_to_specialist(text) to service_role;
