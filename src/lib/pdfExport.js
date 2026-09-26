import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoUrl from '../assets/logo.png'
import { docTypeLabel } from './labels'
import { formatChf, formatDateTime, fullName, safeFileName } from './format'
import { FIRM_CONTACT } from './constants'

const GOLD = [169, 133, 69]
const INK = [39, 37, 34]
const MUTED = [140, 136, 128]
const PANEL = [250, 248, 244]
const LINE = [232, 226, 214]

// Sections included in the client-facing document, in order — "base"/"other"
// stay screen-only (administrative fields, not part of the handed-over
// calculation document).
const PDF_SECTIONS = [
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

// Builds the same "verified field values, grouped by document" rows the
// on-screen collective view shows, for one section's categories.
function sectionRows(section, lang) {
  const rows = []
  section.categories.forEach(({ category, documents }) => {
    documents.forEach((docGroup) => {
      docGroup.fields
        .filter((f) => f.verified_by_specialist)
        .forEach((f) => {
          rows.push([
            f.field_label,
            `${docTypeLabel(category, lang) || ''} — ${docGroup.fileName}`,
            f.field_value || '—'
          ])
        })
    })
  })
  return rows
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
    { label: t('summary.taxableIncomeCantonal'), value: formatChf(result.aggregate.taxable_income_cantonal, lang) },
    { label: t('summary.taxableWealthCantonal'), value: formatChf(result.aggregate.taxable_wealth_cantonal, lang) },
    { label: t('summary.taxableIncomeFederal'), value: formatChf(result.aggregate.taxable_income_federal, lang) }
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

  // ------------------------------------------------------------ sections ---
  for (const { key, titleKey } of PDF_SECTIONS) {
    const section = sections.find((s) => s.key === key)
    const rows = section ? sectionRows(section, lang) : []

    ensureSpace(20)
    doc.setFontSize(12.5)
    doc.setTextColor(...INK)
    doc.text(t(titleKey), marginX, y)
    y += 5

    if (rows.length) {
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [[t('summary.colItem'), t('summary.colSource'), t('summary.colAmount')]],
        body: rows,
        styles: { fontSize: 9, cellPadding: 2.5, textColor: INK },
        headStyles: { fillColor: GOLD, textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [252, 251, 248] },
        theme: 'grid'
      })
      y = doc.lastAutoTable.finalY + 10
    } else {
      doc.setFontSize(9.5)
      doc.setTextColor(...MUTED)
      doc.text(t('summary.noData'), marginX, y + 5)
      y += 14
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
