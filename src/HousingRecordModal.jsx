import { X } from 'lucide-react'
import { useState } from 'react'
import { useHousingLanguage } from './housingI18n.jsx'

function normalizeForm(form, fields) {
  return Object.fromEntries(fields.map((field) => {
    const value = form[field.key]
    if (value === '' && !field.required) return [field.key, null]
    if (field.type === 'number' && value !== '') return [field.key, Number(value)]
    if (field.type === 'datetime-local' && value) return [field.key, new Date(value).toISOString()]
    return [field.key, value]
  }))
}

export function HousingRecordModal({ titleAr, titleEn, fields, initial = {}, onClose, onSave, saving }) {
  const { language, t } = useHousingLanguage()
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((field) => [field.key, initial[field.key] ?? field.defaultValue ?? ''])))
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const title = language === 'ar' ? titleAr : titleEn

  return <div className="housing-modal-backdrop" onMouseDown={onClose}>
    <div className="housing-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2>{title}</h2><p>{t('liveData')}</p></div><button type="button" onClick={onClose} aria-label={t('cancel')}><X size={20} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); onSave(normalizeForm(form, fields)) }}>
        <div className="housing-form-grid">{fields.map((field) => <label key={field.key} className={field.full ? 'full' : ''}>
          <span>{language === 'ar' ? field.ar : field.en}</span>
          {field.type === 'select'
            ? <select required={field.required} value={form[field.key]} onChange={update(field.key)}><option value="">{language === 'ar' ? 'اختر...' : 'Select...'}</option>{(field.options || []).map((option) => <option key={option.value} value={option.value}>{language === 'ar' ? option.ar ?? option.label : option.en ?? option.label}</option>)}</select>
            : field.type === 'textarea'
              ? <textarea required={field.required} rows="3" value={form[field.key]} onChange={update(field.key)} />
              : <input required={field.required} type={field.type || 'text'} min={field.min} max={field.max} step={field.step} value={form[field.key]} onChange={update(field.key)} />}
        </label>)}</div>
        <footer><button type="button" className="housing-secondary-button" onClick={onClose}>{t('cancel')}</button><button className="housing-primary-button" disabled={saving}>{saving ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : t('save')}</button></footer>
      </form>
    </div>
  </div>
}

export function HousingDetailsModal({ title, rows, onClose }) {
  const { language, t } = useHousingLanguage()
  return <div className="housing-modal-backdrop" onMouseDown={onClose}>
    <div className="housing-modal housing-details-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2>{title}</h2><p>{t('liveData')}</p></div><button type="button" onClick={onClose} aria-label={t('cancel')}><X size={20} /></button></header>
      <div className="housing-details-grid">{rows.filter((row) => row.value !== null && row.value !== undefined && row.value !== '').map((row) => <div key={row.label}><span>{row.label}</span><strong>{String(row.value)}</strong></div>)}</div>
      <footer className="housing-modal-actions"><button type="button" className="housing-primary-button" onClick={onClose}>{language === 'ar' ? 'إغلاق' : 'Close'}</button></footer>
    </div>
  </div>
}
