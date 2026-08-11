import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, Mail, MessageCircle, Phone, Plus, RefreshCw, Send, Settings2, Trash2, X } from 'lucide-react'
import { useHousingLanguage } from './housingI18n.jsx'
import {
  createHousingNotificationRecipient,
  deleteHousingNotificationRecipient,
  markHousingNotificationRead,
  prepareHousingWeeklyDigest,
  retryHousingNotificationDelivery,
  saveHousingNotificationSettings,
} from './housingService.mjs'
import { buildHousingNotificationRecipient, buildHousingNotificationSettings, HOUSING_NOTIFICATION_CHANNELS, summarizeHousingNotifications } from './housingNotifications.mjs'

const DEFAULT_SETTINGS = {
  in_app_enabled: true, email_enabled: true, sms_enabled: false, whatsapp_enabled: false,
  critical_incident_channels: ['In App'], weekly_digest_channels: ['In App', 'Email'],
  license_days_before: 30, maintenance_sla_hours: 24, digest_weekday: 0, digest_hour: 8, timezone: 'Asia/Riyadh',
}

const emptyRecipient = { name: '', role_label: '', email: '', phone_e164: '', whatsapp_e164: '', site_id: '', channels: ['In App'], critical_only: false }

export default function HousingNotificationsPage({ client, companyId, data, canManage, onRefresh }) {
  const { language } = useHousingLanguage()
  const ar = language === 'ar'
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [recipient, setRecipient] = useState(emptyRecipient)
  const [showRecipient, setShowRecipient] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const metrics = useMemo(() => summarizeHousingNotifications(data.notificationEvents, data.notificationDeliveries), [data])

  useEffect(() => { setSettings({ ...DEFAULT_SETTINGS, ...(data.notificationSettings || {}) }) }, [data.notificationSettings])

  const run = async (key, operation) => {
    setBusy(key); setMessage('')
    try { await operation(); await onRefresh(); setMessage(ar ? 'تم الحفظ بنجاح' : 'Saved successfully') }
    catch (error) { setMessage(error?.message || (ar ? 'تعذر تنفيذ العملية' : 'Operation failed')) }
    finally { setBusy('') }
  }

  const saveSettings = () => run('settings', () => saveHousingNotificationSettings(client, buildHousingNotificationSettings(settings, companyId)))
  const addRecipient = () => run('recipient', async () => {
    await createHousingNotificationRecipient(client, buildHousingNotificationRecipient(recipient, companyId))
    setRecipient(emptyRecipient); setShowRecipient(false)
  })
  const toggleChannel = (field, channel) => setSettings((current) => ({ ...current, [field]: current[field].includes(channel) ? current[field].filter((item) => item !== channel) : [...current[field], channel] }))
  const toggleRecipientChannel = (channel) => setRecipient((current) => ({ ...current, channels: current.channels.includes(channel) ? current.channels.filter((item) => item !== channel) : [...current.channels, channel] }))

  return <div className="housing-notifications-page">
    <section className="housing-notification-summary">
      {[
        [Bell, ar ? 'غير مقروءة' : 'Unread', metrics.unread, 'blue'],
        [AlertTriangle, ar ? 'حرجة' : 'Critical', metrics.critical, 'rose'],
        [Send, ar ? 'بانتظار الإرسال' : 'Queued', metrics.queued, 'amber'],
        [CheckCircle2, ar ? 'تم إرسالها' : 'Sent', metrics.sent, 'green'],
        [X, ar ? 'فشلت' : 'Failed', metrics.failed, 'rose'],
      ].map(([Icon, label, value, tone]) => <article className="housing-panel" key={label}><span className={`housing-notification-metric ${tone}`}><Icon size={19} /></span><div><small>{label}</small><strong>{value}</strong></div></article>)}
    </section>

    <section className="housing-notification-toolbar housing-panel">
      <div><h3>{ar ? 'مركز الإشعارات متعدد القنوات' : 'Multi-Channel Notification Center'}</h3><p>{ar ? 'تنبيهات الحوادث الحرجة والملخصات الأسبوعية مع سجل كامل لكل محاولة إرسال.' : 'Critical incident alerts and weekly digests with a complete delivery audit trail.'}</p></div>
      <div>
        {canManage && <button className="housing-secondary-button" onClick={() => run('digest', () => prepareHousingWeeklyDigest(client))} disabled={Boolean(busy)}><RefreshCw size={16} />{ar ? 'إنشاء ملخص تجريبي' : 'Prepare test digest'}</button>}
        {canManage && <button className="housing-primary-button" onClick={() => setShowRecipient(true)}><Plus size={16} />{ar ? 'إضافة مستلم' : 'Add recipient'}</button>}
      </div>
    </section>
    {message && <div className="housing-form-message">{message}</div>}

    <section className="housing-notification-layout">
      <article className="housing-panel housing-notification-feed">
        <header><div><h3>{ar ? 'الإشعارات داخل المنصة' : 'In-App Notifications'}</h3><p>{data.notificationEvents.length} {ar ? 'تنبيه' : 'notifications'}</p></div></header>
        <div className="housing-notification-scroll">
          {data.notificationEvents.length === 0 && <p className="housing-notification-empty">{ar ? 'لا توجد إشعارات بعد.' : 'No notifications yet.'}</p>}
          {data.notificationEvents.map((event) => <button key={event.id} className={`housing-notification-item ${event.status === 'Unread' ? 'unread' : ''}`} onClick={() => event.status === 'Unread' && run(`read-${event.id}`, () => markHousingNotificationRead(client, event.id))}>
            <span className={`housing-notification-severity ${String(event.severity).toLowerCase()}`}><AlertTriangle size={16} /></span>
            <span><strong>{ar ? event.title_ar : event.title_en}</strong><small>{ar ? event.body_ar : event.body_en}</small><em>{new Date(event.created_at).toLocaleString(ar ? 'ar-SA' : 'en-US')}</em></span>
            <i>{event.status}</i>
          </button>)}
        </div>
      </article>

      <article className="housing-panel housing-notification-settings">
        <header><div><h3>{ar ? 'إعدادات القنوات' : 'Channel Settings'}</h3><p>{ar ? 'مفاتيح المزود تحفظ في Supabase Secrets ولا تظهر للمستخدمين.' : 'Provider keys stay in Supabase Secrets and are never exposed to users.'}</p></div><Settings2 size={20} /></header>
        <div className="housing-channel-switches">
          {[[Bell, 'in_app_enabled', 'In App'], [Mail, 'email_enabled', 'Email'], [Phone, 'sms_enabled', 'SMS'], [MessageCircle, 'whatsapp_enabled', 'WhatsApp']].map(([Icon, key, label]) => <label key={key}><Icon size={17} /><span>{label}</span><input type="checkbox" checked={Boolean(settings[key])} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked }))} /></label>)}
        </div>
        <ChannelPicker title={ar ? 'قنوات الحوادث الحرجة' : 'Critical incident channels'} value={settings.critical_incident_channels} onToggle={(channel) => toggleChannel('critical_incident_channels', channel)} disabled={!canManage} />
        <ChannelPicker title={ar ? 'قنوات الملخص الأسبوعي' : 'Weekly digest channels'} value={settings.weekly_digest_channels} onToggle={(channel) => toggleChannel('weekly_digest_channels', channel)} disabled={!canManage} />
        <div className="housing-notification-schedule">
          <label><span>{ar ? 'التراخيص خلال (يوم)' : 'License horizon (days)'}</span><input type="number" min="1" max="365" value={settings.license_days_before} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, license_days_before: event.target.value }))} /></label>
          <label><span>{ar ? 'مهلة الصيانة (ساعة)' : 'Maintenance SLA (hours)'}</span><input type="number" min="1" max="720" value={settings.maintenance_sla_hours} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, maintenance_sla_hours: event.target.value }))} /></label>
        </div>
        {canManage && <button className="housing-primary-button" onClick={saveSettings} disabled={Boolean(busy)}>{ar ? 'حفظ الإعدادات' : 'Save settings'}</button>}
      </article>
    </section>

    <section className="housing-panel housing-notification-recipients">
      <header><div><h3>{ar ? 'المستلمون' : 'Recipients'}</h3><p>{ar ? 'مدراء السكن وHSE والمدراء المناوبون' : 'Housing, HSE and duty managers'}</p></div></header>
      <div className="housing-table-wrap"><table><thead><tr><th>{ar ? 'الاسم' : 'Name'}</th><th>{ar ? 'الدور' : 'Role'}</th><th>{ar ? 'القنوات' : 'Channels'}</th><th>{ar ? 'بيانات التواصل' : 'Destination'}</th><th>{ar ? 'النطاق' : 'Scope'}</th><th /></tr></thead><tbody>
        {data.notificationRecipients.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.role_label || '-'}</td><td>{item.channels?.join(' · ')}</td><td>{item.email || item.phone_e164 || item.whatsapp_e164 || '-'}</td><td>{item.site?.name || (ar ? 'جميع السكنات' : 'All sites')}</td><td>{canManage && <button className="housing-icon-button" onClick={() => run(`delete-${item.id}`, () => deleteHousingNotificationRecipient(client, item.id))}><Trash2 size={15} /></button>}</td></tr>)}
        {!data.notificationRecipients.length && <tr><td colSpan="6">{ar ? 'أضف أول مستلم لتفعيل الإرسال الخارجي.' : 'Add the first recipient to enable external delivery.'}</td></tr>}
      </tbody></table></div>
    </section>

    <section className="housing-panel housing-notification-deliveries">
      <header><div><h3>{ar ? 'سجل الإرسال' : 'Delivery Log'}</h3><p>{ar ? 'حالة كل رسالة ومزود الإرسال' : 'Every message attempt and provider status'}</p></div></header>
      <div className="housing-table-wrap"><table><thead><tr><th>{ar ? 'القناة' : 'Channel'}</th><th>{ar ? 'التنبيه' : 'Notification'}</th><th>{ar ? 'المستلم' : 'Destination'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'المحاولات' : 'Attempts'}</th><th>{ar ? 'الخطأ/المزود' : 'Provider / Error'}</th><th /></tr></thead><tbody>
        {data.notificationDeliveries.map((item) => <tr key={item.id}><td>{item.channel}</td><td>{ar ? item.event?.title_ar : item.event?.title_en}</td><td>{item.destination}</td><td><span className={`housing-delivery-status ${String(item.status).toLowerCase()}`}>{item.status}</span></td><td>{item.attempts}</td><td>{item.provider || item.last_error || '-'}</td><td>{canManage && item.status === 'Failed' && <button onClick={() => run(`retry-${item.id}`, () => retryHousingNotificationDelivery(client, item.id))}>{ar ? 'إعادة' : 'Retry'}</button>}</td></tr>)}
        {!data.notificationDeliveries.length && <tr><td colSpan="7">{ar ? 'لا توجد محاولات إرسال خارجية.' : 'No external delivery attempts.'}</td></tr>}
      </tbody></table></div>
    </section>

    {showRecipient && <div className="housing-modal-backdrop"><div className="housing-modal housing-notification-recipient-modal"><header><div><h2>{ar ? 'إضافة مستلم' : 'Add recipient'}</h2><p>{ar ? 'استخدم أرقام E.164 مثل +9665XXXXXXXX.' : 'Use E.164 numbers such as +9665XXXXXXXX.'}</p></div><button onClick={() => setShowRecipient(false)}><X size={20} /></button></header><div className="housing-form-grid">
      <label><span>{ar ? 'الاسم' : 'Name'}</span><input value={recipient.name} onChange={(event) => setRecipient((current) => ({ ...current, name: event.target.value }))} /></label>
      <label><span>{ar ? 'الدور' : 'Role'}</span><input value={recipient.role_label} onChange={(event) => setRecipient((current) => ({ ...current, role_label: event.target.value }))} /></label>
      <label><span>Email</span><input type="email" value={recipient.email} onChange={(event) => setRecipient((current) => ({ ...current, email: event.target.value }))} /></label>
      <label><span>SMS</span><input placeholder="+966..." value={recipient.phone_e164} onChange={(event) => setRecipient((current) => ({ ...current, phone_e164: event.target.value }))} /></label>
      <label><span>WhatsApp</span><input placeholder="+966..." value={recipient.whatsapp_e164} onChange={(event) => setRecipient((current) => ({ ...current, whatsapp_e164: event.target.value }))} /></label>
      <label><span>{ar ? 'السكن' : 'Housing site'}</span><select value={recipient.site_id} onChange={(event) => setRecipient((current) => ({ ...current, site_id: event.target.value }))}><option value="">{ar ? 'جميع السكنات' : 'All sites'}</option>{data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      <div className="full"><ChannelPicker title={ar ? 'القنوات' : 'Channels'} value={recipient.channels} onToggle={toggleRecipientChannel} /></div>
      <label className="housing-check-label full"><input type="checkbox" checked={recipient.critical_only} onChange={(event) => setRecipient((current) => ({ ...current, critical_only: event.target.checked }))} />{ar ? 'الحوادث العالية والحرجة فقط' : 'High and critical incidents only'}</label>
    </div><footer><button className="housing-secondary-button" onClick={() => setShowRecipient(false)}>{ar ? 'إلغاء' : 'Cancel'}</button><button className="housing-primary-button" onClick={addRecipient} disabled={Boolean(busy)}>{ar ? 'حفظ المستلم' : 'Save recipient'}</button></footer></div></div>}
  </div>
}

function ChannelPicker({ title, value = [], onToggle, disabled }) {
  return <div className="housing-channel-picker"><strong>{title}</strong><div>{HOUSING_NOTIFICATION_CHANNELS.map((channel) => <label key={channel} className={value.includes(channel) ? 'selected' : ''}><input type="checkbox" checked={value.includes(channel)} disabled={disabled} onChange={() => onToggle(channel)} />{channel}</label>)}</div></div>
}
