import { useState } from 'react'
import { Bot } from 'lucide-react'
import { Field, Select } from '../ui'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useI18n } from '../../i18n'
import { api } from '../../lib/data'
import { AI_MODELS } from '../../lib/aiModels'

// Which Claude model the extraction and the assistant use (ai_model_settings;
// see src/lib/aiModels.js — a choice here beats the env var).
export default function AiModelsTab({ aiModelSettings, setAiModelSettings }) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const toast = useToast()
  const [aiModelBusyKey, setAiModelBusyKey] = useState(null)

  const aiModelFor = (key) => aiModelSettings.find((m) => m.key === key)?.model || ''

  const setAiModel = async (key, model) => {
    setAiModelBusyKey(key)
    try {
      const saved = await api.saveAiModelSetting(key, model || null, profile?.id)
      setAiModelSettings((list) => {
        const idx = list.findIndex((m) => m.key === key)
        if (idx === -1) return [...list, saved]
        const copy = [...list]
        copy[idx] = saved
        return copy
      })
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setAiModelBusyKey(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card card-pad space-y-4">
        <div className="flex items-start gap-2.5">
          <Bot size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
          <div>
            <h2 className="section-title text-xl">{t('taxSettings.aiExtractionTitle')}</h2>
            <p className="section-sub">{t('taxSettings.aiExtractionHelp')}</p>
          </div>
        </div>
        <Field label={t('taxSettings.aiModel')} htmlFor="ai-extraction-model" className="max-w-xs">
          <Select
            id="ai-extraction-model"
            value={aiModelFor('extraction_model')}
            disabled={aiModelBusyKey === 'extraction_model'}
            onChange={(e) => setAiModel('extraction_model', e.target.value)}
          >
            <option value="">{t('taxSettings.aiModelDefault')}</option>
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {aiModelFor('extraction_model') ? (
          <p className="text-[12.5px] text-ink-400">
            {AI_MODELS.find((m) => m.id === aiModelFor('extraction_model'))?.note}
          </p>
        ) : null}
      </div>

      <div className="card card-pad space-y-4">
        <div className="flex items-start gap-2.5">
          <Bot size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
          <div>
            <h2 className="section-title text-xl">{t('taxSettings.aiAssistantTitle')}</h2>
            <p className="section-sub">{t('taxSettings.aiAssistantHelp')}</p>
          </div>
        </div>
        <Field label={t('taxSettings.aiModel')} htmlFor="ai-assistant-model" className="max-w-xs">
          <Select
            id="ai-assistant-model"
            value={aiModelFor('assistant_model')}
            disabled={aiModelBusyKey === 'assistant_model'}
            onChange={(e) => setAiModel('assistant_model', e.target.value)}
          >
            <option value="">{t('taxSettings.aiModelDefault')}</option>
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {aiModelFor('assistant_model') ? (
          <p className="text-[12.5px] text-ink-400">
            {AI_MODELS.find((m) => m.id === aiModelFor('assistant_model'))?.note}
          </p>
        ) : null}
      </div>
    </div>
  )
}
