import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, Users, Car, Home, User, Info, MessageSquare } from 'lucide-react'
import { Checkbox, Field, PageLoader, Select, Spinner, TextInput, Textarea } from './ui'
import { useI18n } from '../i18n'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/data'
import { CANTONS, MARITAL_STATUSES, PERMIT_TYPES } from '../lib/constants'

const emptyPerson = (type) => ({
  person_type: type,
  first_name: '',
  last_name: '',
  mobile_phone: '',
  email: '',
  marital_status: '',
  date_of_birth: '',
  religious_denomination: '',
  current_address: '',
  address_dec31: '',
  profession: '',
  employer: '',
  employer_address: '',
  work_percentage: '',
  public_transport_costs: '',
  car_km_home_to_work: '',
  work_address: '',
  other_work_costs: '',
  is_self_employed: false,
  qualifying_shareholdings: 0,
  asset_statement_count: 0
})

function SectionCard({ icon: Icon, title, description, children, actions }) {
  return (
    <section className="card card-pad">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {Icon ? <Icon size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" /> : null}
          <div>
            <h2 className="section-title text-xl">{title}</h2>
            {description ? <p className="section-sub">{description}</p> : null}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function PersonFields({ person, onChange, disabled, idPrefix }) {
  const { t } = useI18n()
  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    onChange({ ...person, [key]: value })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('data.f.firstName')} htmlFor={`${idPrefix}-first`}>
        <TextInput id={`${idPrefix}-first`} value={person.first_name || ''} onChange={set('first_name')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.lastName')} htmlFor={`${idPrefix}-last`}>
        <TextInput id={`${idPrefix}-last`} value={person.last_name || ''} onChange={set('last_name')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.dateOfBirth')} htmlFor={`${idPrefix}-dob`}>
        <TextInput id={`${idPrefix}-dob`} type="date" value={person.date_of_birth || ''} onChange={set('date_of_birth')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.maritalStatus')} htmlFor={`${idPrefix}-marital`}>
        <Select id={`${idPrefix}-marital`} value={person.marital_status || ''} onChange={set('marital_status')} disabled={disabled}>
          <option value="">{t('common.none')}</option>
          {MARITAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`marital.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('data.f.mobile')} htmlFor={`${idPrefix}-mobile`}>
        <TextInput id={`${idPrefix}-mobile`} value={person.mobile_phone || ''} onChange={set('mobile_phone')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.email')} htmlFor={`${idPrefix}-email`}>
        <TextInput id={`${idPrefix}-email`} type="email" value={person.email || ''} onChange={set('email')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.religion')} hint={t('data.f.religionHelp')} htmlFor={`${idPrefix}-religion`}>
        <TextInput id={`${idPrefix}-religion`} value={person.religious_denomination || ''} onChange={set('religious_denomination')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.profession')} htmlFor={`${idPrefix}-profession`}>
        <TextInput id={`${idPrefix}-profession`} value={person.profession || ''} onChange={set('profession')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.currentAddress')} htmlFor={`${idPrefix}-address`} className="sm:col-span-2">
        <TextInput id={`${idPrefix}-address`} value={person.current_address || ''} onChange={set('current_address')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.addressDec31')} htmlFor={`${idPrefix}-address31`} className="sm:col-span-2">
        <TextInput id={`${idPrefix}-address31`} value={person.address_dec31 || ''} onChange={set('address_dec31')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.employer')} htmlFor={`${idPrefix}-employer`}>
        <TextInput id={`${idPrefix}-employer`} value={person.employer || ''} onChange={set('employer')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.employerAddress')} htmlFor={`${idPrefix}-employer-address`}>
        <TextInput id={`${idPrefix}-employer-address`} value={person.employer_address || ''} onChange={set('employer_address')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.workPercentage')} htmlFor={`${idPrefix}-pct`}>
        <TextInput id={`${idPrefix}-pct`} type="number" min="0" max="100" value={person.work_percentage ?? ''} onChange={set('work_percentage')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.publicTransport')} htmlFor={`${idPrefix}-pt`}>
        <TextInput id={`${idPrefix}-pt`} type="number" min="0" step="0.05" value={person.public_transport_costs ?? ''} onChange={set('public_transport_costs')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.carKm')} htmlFor={`${idPrefix}-km`}>
        <TextInput id={`${idPrefix}-km`} type="number" min="0" step="0.1" value={person.car_km_home_to_work ?? ''} onChange={set('car_km_home_to_work')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.assetUnits')} hint={t('data.f.assetUnitsHelp')} htmlFor={`${idPrefix}-assets`}>
        <TextInput id={`${idPrefix}-assets`} type="number" min="0" value={person.asset_statement_count ?? 0} onChange={set('asset_statement_count')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.shareholdings')} htmlFor={`${idPrefix}-shares`}>
        <TextInput id={`${idPrefix}-shares`} type="number" min="0" value={person.qualifying_shareholdings ?? 0} onChange={set('qualifying_shareholdings')} disabled={disabled} />
      </Field>
      <Field label={t('data.f.otherWorkCosts')} htmlFor={`${idPrefix}-other`} className="sm:col-span-2">
        <TextInput id={`${idPrefix}-other`} value={person.other_work_costs || ''} onChange={set('other_work_costs')} disabled={disabled} />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox
          id={`${idPrefix}-self`}
          label={t('data.f.selfEmployed')}
          checked={Boolean(person.is_self_employed)}
          onChange={set('is_self_employed')}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

function RowCard({ children, onRemove, disabled, label }) {
  return (
    <div className="relative rounded-xl border border-line bg-sand/50 p-4">
      {!disabled ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-2 top-2 rounded-lg p-2 text-ink-400 transition hover:bg-white hover:text-red-700"
          aria-label={label}
        >
          <Trash2 size={16} />
        </button>
      ) : null}
      {children}
    </div>
  )
}

export default function QuestionnaireForm({ clientId, readOnly = false, onSaved }) {
  const { t } = useI18n()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [details, setDetails] = useState({})
  const [primary, setPrimary] = useState(emptyPerson('primary'))
  const [spouse, setSpouse] = useState(null)
  const [children, setChildren] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [properties, setProperties] = useState([])

  useEffect(() => {
    let active = true
    if (!clientId) return undefined
    setLoading(true)
    api.getQuestionnaire(clientId).then((data) => {
      if (!active) return
      setDetails(data.details || {})
      setPrimary(data.persons.find((p) => p.person_type === 'primary') || emptyPerson('primary'))
      setSpouse(data.persons.find((p) => p.person_type === 'spouse') || null)
      setChildren(data.children || [])
      setVehicles(data.vehicles || [])
      setProperties(data.properties || [])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [clientId])

  const setDetail = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setDetails((d) => ({ ...d, [key]: value }))
  }

  const updateRow = (setter) => (index, patch) =>
    setter((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const removeRow = (setter) => (index) =>
    setter((rows) => rows.filter((_, i) => i !== index))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const persons = [primary, ...(spouse ? [spouse] : [])].map((p) => ({
        ...p,
        person_type: p.person_type,
        work_percentage: p.work_percentage === '' ? null : Number(p.work_percentage),
        public_transport_costs: p.public_transport_costs === '' ? null : Number(p.public_transport_costs),
        car_km_home_to_work: p.car_km_home_to_work === '' ? null : Number(p.car_km_home_to_work),
        asset_statement_count: Number(p.asset_statement_count || 0),
        qualifying_shareholdings: Number(p.qualifying_shareholdings || 0),
        date_of_birth: p.date_of_birth || null
      }))
      await api.saveQuestionnaire(clientId, {
        details: { ...details, due_date: details.due_date || null },
        persons,
        children: children.map((c) => ({ ...c, date_of_birth: c.date_of_birth || null })),
        vehicles,
        properties
      })
      toast.success(t('data.savedOk'))
      onSaved?.()
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoader label={t('common.loading')} />

  const disabled = readOnly

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* ------------------------------------------------------- general -- */}
      <SectionCard icon={Info} title={t('data.general')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('data.f.inCHSince')} htmlFor="in-ch">
            <TextInput id="in-ch" value={details.in_ch_since || ''} onChange={setDetail('in_ch_since')} disabled={disabled} placeholder="2016" />
          </Field>
          <Field label={t('data.f.ageOnArrival')} htmlFor="age-arrival">
            <TextInput id="age-arrival" value={details.age_on_arrival || ''} onChange={setDetail('age_on_arrival')} disabled={disabled} />
          </Field>
          <Field label={t('data.f.nationality')} htmlFor="nationality">
            <TextInput id="nationality" value={details.nationality || ''} onChange={setDetail('nationality')} disabled={disabled} />
          </Field>
          <Field label={t('data.f.permit')} htmlFor="permit">
            <Select id="permit" value={details.permit_type || ''} onChange={setDetail('permit_type')} disabled={disabled}>
              <option value="">{t('common.none')}</option>
              {PERMIT_TYPES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('data.f.canton')} htmlFor="canton">
            <Select id="canton" value={details.canton || ''} onChange={setDetail('canton')} disabled={disabled}>
              <option value="">{t('common.none')}</option>
              {CANTONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('data.f.dueDate')} htmlFor="due-date">
            <TextInput id="due-date" type="date" value={details.due_date || ''} onChange={setDetail('due_date')} disabled={disabled} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Checkbox
              id="crypto"
              label={t('data.f.cryptoShares')}
              checked={Boolean(details.has_crypto_or_shares)}
              onChange={setDetail('has_crypto_or_shares')}
              disabled={disabled}
            />
          </div>
        </div>
      </SectionCard>

      {/* ----------------------------------------------------- taxpayer --- */}
      <SectionCard icon={User} title={t('data.taxpayer')}>
        <PersonFields person={primary} onChange={setPrimary} disabled={disabled} idPrefix="primary" />
      </SectionCard>

      {/* ------------------------------------------------------- spouse --- */}
      <SectionCard
        icon={Users}
        title={t('data.spouse')}
        actions={
          !disabled ? (
            <Checkbox
              id="has-spouse"
              label={t('data.spouseToggle')}
              checked={Boolean(spouse)}
              onChange={(e) => setSpouse(e.target.checked ? emptyPerson('spouse') : null)}
            />
          ) : null
        }
      >
        {spouse ? (
          <PersonFields person={spouse} onChange={setSpouse} disabled={disabled} idPrefix="spouse" />
        ) : (
          <p className="text-[14.5px] text-ink-400">{t('common.notProvided')}</p>
        )}
      </SectionCard>

      {/* ----------------------------------------------------- children --- */}
      <SectionCard
        icon={Users}
        title={t('data.children')}
        actions={
          !disabled ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setChildren((rows) => [...rows, { full_name: '', date_of_birth: '', school_education: '', religious: '', until_when: '', custody: '' }])}
            >
              <Plus size={16} aria-hidden="true" />
              {t('data.addChild')}
            </button>
          ) : null
        }
      >
        {children.length ? (
          <div className="space-y-3">
            {children.map((child, index) => (
              <RowCard key={index} onRemove={() => removeRow(setChildren)(index)} disabled={disabled} label={t('common.remove')}>
                <div className="grid gap-4 pr-8 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={t('data.f.childName')}>
                    <TextInput value={child.full_name || ''} onChange={(e) => updateRow(setChildren)(index, { full_name: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.dateOfBirth')}>
                    <TextInput type="date" value={child.date_of_birth || ''} onChange={(e) => updateRow(setChildren)(index, { date_of_birth: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.childSchool')}>
                    <TextInput value={child.school_education || ''} onChange={(e) => updateRow(setChildren)(index, { school_education: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.childReligion')}>
                    <TextInput value={child.religious || ''} onChange={(e) => updateRow(setChildren)(index, { religious: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.childUntil')}>
                    <TextInput value={child.until_when || ''} onChange={(e) => updateRow(setChildren)(index, { until_when: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.childCustody')}>
                    <TextInput value={child.custody || ''} onChange={(e) => updateRow(setChildren)(index, { custody: e.target.value })} disabled={disabled} />
                  </Field>
                </div>
              </RowCard>
            ))}
          </div>
        ) : (
          <p className="text-[14.5px] text-ink-400">{t('common.notProvided')}</p>
        )}
      </SectionCard>

      {/* ----------------------------------------------------- vehicles --- */}
      <SectionCard
        icon={Car}
        title={t('data.vehicles')}
        actions={
          !disabled ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setVehicles((rows) => [...rows, { brand: '', model: '', year_of_issue: '', purchase_price: '', purchase_year: '', leasing: false, license_plate: '' }])}
            >
              <Plus size={16} aria-hidden="true" />
              {t('data.addVehicle')}
            </button>
          ) : null
        }
      >
        {vehicles.length ? (
          <div className="space-y-3">
            {vehicles.map((vehicle, index) => (
              <RowCard key={index} onRemove={() => removeRow(setVehicles)(index)} disabled={disabled} label={t('common.remove')}>
                <div className="grid gap-4 pr-8 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={t('data.f.brand')}>
                    <TextInput value={vehicle.brand || ''} onChange={(e) => updateRow(setVehicles)(index, { brand: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.model')}>
                    <TextInput value={vehicle.model || ''} onChange={(e) => updateRow(setVehicles)(index, { model: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.yearOfIssue')}>
                    <TextInput type="number" value={vehicle.year_of_issue || ''} onChange={(e) => updateRow(setVehicles)(index, { year_of_issue: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.purchasePrice')}>
                    <TextInput type="number" value={vehicle.purchase_price || ''} onChange={(e) => updateRow(setVehicles)(index, { purchase_price: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.purchaseYear')}>
                    <TextInput type="number" value={vehicle.purchase_year || ''} onChange={(e) => updateRow(setVehicles)(index, { purchase_year: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.plate')}>
                    <TextInput value={vehicle.license_plate || ''} onChange={(e) => updateRow(setVehicles)(index, { license_plate: e.target.value })} disabled={disabled} />
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Checkbox
                      id={`leasing-${index}`}
                      label={t('data.f.leasing')}
                      checked={Boolean(vehicle.leasing)}
                      onChange={(e) => updateRow(setVehicles)(index, { leasing: e.target.checked })}
                      disabled={disabled}
                    />
                  </div>
                </div>
              </RowCard>
            ))}
          </div>
        ) : (
          <p className="text-[14.5px] text-ink-400">{t('common.notProvided')}</p>
        )}
      </SectionCard>

      {/* --------------------------------------------------- properties --- */}
      <SectionCard
        icon={Home}
        title={t('data.properties')}
        actions={
          !disabled ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setProperties((rows) => [...rows, { address: '', country: '', purchase_year: '', year_of_building: '', purchase_price: '', rental_income: '', number_of_rooms: '' }])}
            >
              <Plus size={16} aria-hidden="true" />
              {t('data.addProperty')}
            </button>
          ) : null
        }
      >
        {properties.length ? (
          <div className="space-y-3">
            {properties.map((property, index) => (
              <RowCard key={index} onRemove={() => removeRow(setProperties)(index)} disabled={disabled} label={t('common.remove')}>
                <div className="grid gap-4 pr-8 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={t('data.f.address')} className="sm:col-span-2">
                    <TextInput value={property.address || ''} onChange={(e) => updateRow(setProperties)(index, { address: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.country')}>
                    <TextInput value={property.country || ''} onChange={(e) => updateRow(setProperties)(index, { country: e.target.value })} disabled={disabled} placeholder="CH" />
                  </Field>
                  <Field label={t('data.f.purchaseYear')}>
                    <TextInput type="number" value={property.purchase_year || ''} onChange={(e) => updateRow(setProperties)(index, { purchase_year: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.yearOfBuilding')}>
                    <TextInput type="number" value={property.year_of_building || ''} onChange={(e) => updateRow(setProperties)(index, { year_of_building: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.purchasePrice')}>
                    <TextInput type="number" value={property.purchase_price || ''} onChange={(e) => updateRow(setProperties)(index, { purchase_price: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.rentalIncome')}>
                    <TextInput type="number" value={property.rental_income || ''} onChange={(e) => updateRow(setProperties)(index, { rental_income: e.target.value })} disabled={disabled} />
                  </Field>
                  <Field label={t('data.f.rooms')}>
                    <TextInput type="number" step="0.5" value={property.number_of_rooms || ''} onChange={(e) => updateRow(setProperties)(index, { number_of_rooms: e.target.value })} disabled={disabled} />
                  </Field>
                </div>
              </RowCard>
            ))}
          </div>
        ) : (
          <p className="text-[14.5px] text-ink-400">{t('common.notProvided')}</p>
        )}
      </SectionCard>

      {/* ----------------------------------------------------- comments --- */}
      <SectionCard icon={MessageSquare} title={t('data.comments')} description={t('data.commentsHelp')}>
        <Textarea
          value={details.comments || ''}
          onChange={setDetail('comments')}
          disabled={disabled}
          rows={5}
        />
      </SectionCard>

      {!disabled ? (
        <div className="sticky bottom-3 z-20 flex justify-end">
          <button type="submit" className="btn-primary shadow-lift" disabled={saving}>
            {saving ? <Spinner size={18} /> : <Save size={18} aria-hidden="true" />}
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      ) : null}
    </form>
  )
}
