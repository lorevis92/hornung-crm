import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { LoadGate } from '../components/LoadState'
import AiModelsTab from '../components/settings/AiModelsTab'
import FieldDictionaryTab from '../components/settings/FieldDictionaryTab'
import PricingTab from '../components/settings/PricingTab'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { useLoad } from '../lib/useLoad'

// Staff settings: the field dictionary the extraction works from, the price
// list behind the fee estimate, and the AI model choice. (The tax parameters
// and calculation rules of the old calculation engine are no longer shown;
// their tables stay in the database untouched.)
export default function TaxSettings() {
  const { t } = useI18n()
  const [tab, setTab] = useState('fields')
  const [categories, setCategories] = useState([])
  const [fields, setFields] = useState([])
  const [pricingItems, setPricingItems] = useState([])
  const [aiModelSettings, setAiModelSettings] = useState([])

  const loadState = useLoad(
    useCallback(async (isCurrent) => {
      const [cats, defs, pricing, aiModels] = await Promise.all([
        api.listDocumentCategories(),
        api.listFieldDefinitions(),
        api.listPricingItemsForStaff(),
        api.listAiModelSettings()
      ])
      if (!isCurrent()) return
      setCategories(cats)
      setFields(defs)
      setPricingItems(pricing)
      setAiModelSettings(aiModels)
    }, [])
  )

  if (loadState.status !== 'ready') return <LoadGate load={loadState} showDetail />

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{t('taxSettings.title')}</p>
        <h1 className="display mt-1 text-[30px] leading-tight sm:text-[36px]">{t('taxSettings.title')}</h1>
        <p className="mt-2 text-[15px] text-ink-500">{t('taxSettings.subtitle')}</p>
      </div>

      <nav className="flex gap-1 border-b border-line" aria-label="Tax settings sections">
        {[
          ['fields', t('taxSettings.fieldsTab')],
          ['pricing', t('taxSettings.pricingTab')],
          ['ai', t('taxSettings.aiTab')]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={clsx(
              '-mb-px border-b-2 px-4 py-2.5 text-[15px] font-medium transition',
              tab === key ? 'border-gold-600 text-gold-800' : 'border-transparent text-ink-500 hover:text-ink-800'
            )}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'fields' ? (
        <FieldDictionaryTab categories={categories} fields={fields} setFields={setFields} />
      ) : tab === 'pricing' ? (
        <PricingTab pricingItems={pricingItems} setPricingItems={setPricingItems} />
      ) : (
        <AiModelsTab aiModelSettings={aiModelSettings} setAiModelSettings={setAiModelSettings} />
      )}
    </div>
  )
}
