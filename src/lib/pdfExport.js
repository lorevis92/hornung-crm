import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoUrl from '../assets/logo.png'
import { verifiedFieldsByDocument } from './extraction'
import { formatAmountSwiss, formatChfSwiss, formatDateTime, fullName, safeFileName } from './format'
import { FIRM_CONTACT } from './constants'

const GOLD = [169, 133, 69]
const INK = [39, 37, 34]
const MUTED = [140, 136, 128]
const PANEL = [250, 248, 244]
const LINE = [232, 226, 214]
const AMBER_TEXT = [146, 96, 12]
const AMBER_PANEL = [253, 246, 232]
const AMBER_LINE = [246, 218, 168]

// Sections included in the client-facing document, in order — "base"/"other"
// stay screen-only (administrative fields, not part of the handed-over
// calculation document).
const CALC_SECTIONS = [
  { key: 'income', titleKey: 'summary.sectionIncome' },
  { key: 'deductions', titleKey: 'summary.sectionDeductions' },
  { key: 'wealth', titleKey: 'summary.sectionWealth' }
]

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('logo failed to load'))
    img.src = url
  })
}

export async function exportTaxSummaryPdf({ caseRow, sections, result, lang, t }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 15
  let y = 15

  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - 15) {
      doc.addPage()
      y = 15
    }
  }

  // ---------------------------------------------------------------- header --
  try {
    const img = await loadImage(logoUrl)
    const logoW = 58
    const logoH = logoW * (img.naturalHeight / img.naturalWidth)
    doc.addImage(img, 'PNG', marginX, y, logoW, logoH)
  } catch {
    // No logo available — the rest of the document still renders fine.
  }

  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  doc.text(FIRM_CONTACT, pageWidth - marginX, y + 5, { align: 'right' })

  y += 24
  doc.setDrawColor(...LINE)
  doc.line(marginX, y, pageWidth - marginX, y)
  y += 10

  const clientName = fullName(caseRow.client) || caseRow.client?.email || ''

  doc.setFontSize(18)
  doc.setTextColor(...INK)
  doc.text(t('summary.pdfTitle'), marginX, y)
  y += 8

  doc.setFontSize(10.5)
  doc.setTextColor(80, 76, 70)
  doc.text(t('summary.pdfPreparedFor', { name: clientName, year: caseRow.tax_year }), marginX, y)
  y += 5.5
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text(t('summary.pdfGeneratedOn', { date: formatDateTime(new Date(), lang) }), marginX, y)
  y += 12

  // ------------------------------------------------------------- totals ----
  const totals = [
    { label: t('summary.taxableIncomeCantonal'), value: formatChfSwiss(result.aggregate.taxable_income_cantonal) },
    { label: t('summary.taxableWealthCantonal'), value: formatChfSwiss(result.aggregate.taxable_wealth_cantonal) },
    { label: t('summary.taxableIncomeFederal'), value: formatChfSwiss(result.aggregate.taxable_income_federal) }
  ]
  const gap = 5
  const boxW = (pageWidth - marginX * 2 - gap * 2) / 3
  const boxH = 24
  totals.forEach((box, i) => {
    const x = marginX + i * (boxW + gap)
    doc.setFillColor(...PANEL)
    doc.setDrawColor(...LINE)
    doc.roundedRect(x, y, boxW, boxH, 2, 2, 'FD')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(box.label.toUpperCase(), x + 4, y + 7, { maxWidth: boxW - 8 })
    doc.setFontSize(14)
    doc.setTextColor(...GOLD)
    doc.text(box.value, x + 4, y + 18)
  })
  y += boxH + 12

  // ----------------------------------------------- how this was calculated --
  const componentsBySection = CALC_SECTIONS.map(({ key, titleKey }) => ({
    key,
    titleKey,
    components: (result.components || []).filter((c) => c.section_key === key && !c.needs_verification)
  })).filter((s) => s.components.length)

  if (componentsBySection.length) {
    ensureSpace(14)
    doc.setFontSize(14)
    doc.setTextColor(...INK)
    doc.text(t('summary.componentsTitle'), marginX, y)
    y += 8

    for (const section of componentsBySection) {
      ensureSpace(18)
      doc.setFontSize(11)
      doc.setTextColor(60, 57, 52)
      doc.text(t(section.titleKey), marginX, y)
      y += 4

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [[t('summary.colItem'), t('summary.colAmount')]],
        body: section.components.map((c) => [
          c.field_label || c.label,
          `${c.component_type === 'deduction' || c.component_type === 'debt' ? '−' : '+'}${formatChfSwiss(Math.abs(c.amount))}`
        ]),
        columnStyles: { 1: { halign: 'right' } },
        styles: { fontSize: 9, cellPadding: 2.5, textColor: INK },
        headStyles: { fillColor: GOLD, textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [252, 251, 248] },
        theme: 'grid'
      })
      y = doc.lastAutoTable.finalY + 8
    }
    y += 4
  }

  // ------------------------------------------------------ needs verification --
  const needsVerificationComponents = (result.components || []).filter((c) => c.needs_verification)

  if (needsVerificationComponents.length) {
    ensureSpace(20)
    doc.setFontSize(14)
    doc.setTextColor(...INK)
    doc.text(t('summary.needsVerificationTitle'), marginX, y)
    y += 6
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(t('summary.needsVerificationHelp'), marginX, y, { maxWidth: pageWidth - marginX * 2 })
    y += 8

    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [[t('summary.colItem'), t('summary.colAmount')]],
      body: needsVerificationComponents.map((c) => [
        c.field_label || c.label,
        c.currency_code ? formatAmountSwiss(Math.abs(c.amount), c.currency_code) : formatChfSwiss(Math.abs(c.amount))
      ]),
      columnStyles: { 1: { halign: 'right' } },
      styles: { fontSize: 9, cellPadding: 2.5, textColor: AMBER_TEXT, fillColor: AMBER_PANEL },
      headStyles: { fillColor: AMBER_LINE, textColor: AMBER_TEXT, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: AMBER_PANEL },
      theme: 'grid'
    })
    y = doc.lastAutoTable.finalY + 10
  }

  // ------------------------------------------------------- document data ---
  const documentDataGroups = sections
    .filter((s) => CALC_SECTIONS.some((cs) => cs.key === s.key))
    .flatMap((s) => verifiedFieldsByDocument(s, lang))

  if (documentDataGroups.length) {
    ensureSpace(16)
    doc.setFontSize(14)
    doc.setTextColor(...INK)
    doc.text(t('summary.documentDataTitle'), marginX, y)
    y += 6
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(t('summary.documentDataHelp'), marginX, y, { maxWidth: pageWidth - marginX * 2 })
    y += 8

    for (const group of documentDataGroups) {
      ensureSpace(14)
      doc.setFontSize(9.5)
      doc.setTextColor(80, 76, 70)
      doc.text(group.heading, marginX, y)
      y += 3

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        body: group.fields.map((f) => [f.label, f.value]),
        columnStyles: { 1: { halign: 'right', textColor: [90, 87, 82] } },
        styles: { fontSize: 8.5, cellPadding: 2, textColor: [110, 106, 99] },
        theme: 'plain'
      })
      y = doc.lastAutoTable.finalY + 6
    }
  }

  // ------------------------------------------------------- tax estimate ----
  ensureSpace(30)
  doc.setFontSize(12.5)
  doc.setTextColor(...INK)
  doc.text(t('summary.taxEstimateTitle'), marginX, y)
  y += 6

  const estimateH = 18
  doc.setFillColor(...PANEL)
  doc.setDrawColor(...LINE)
  doc.roundedRect(marginX, y, pageWidth - marginX * 2, estimateH, 2, 2, 'FD')
  doc.setFontSize(9.5)
  doc.setTextColor(...MUTED)
  doc.text(t('summary.taxEstimatePlaceholder'), marginX + 5, y + 11, {
    maxWidth: pageWidth - marginX * 2 - 10
  })
  y += estimateH

  doc.save(`${safeFileName(clientName || 'client')}-${caseRow.tax_year}-tax-summary.pdf`)
}
