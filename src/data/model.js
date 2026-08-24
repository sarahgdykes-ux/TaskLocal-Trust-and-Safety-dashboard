import Papa from 'papaparse'
import { createClient } from '@supabase/supabase-js'

const DATA_FILES = ['customers', 'listings', 'bookings', 'chatbot_requests', 'trust_safety']
const STORAGE_KEY = 'tasklocal-report-status-overrides'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

export const FLAG_LABELS = {
  low_rating: 'Low rating',
  no_show: 'No-show',
  pricing_dispute: 'Pricing dispute',
  safety_concern: 'Safety concern',
}

export const STATUS_LABELS = {
  pending_review: 'Pending review',
  investigating: 'Investigating',
  resolved: 'Resolved',
}

export const SERVICE_LABELS = {
  cleaning: 'Cleaning',
  handyman: 'Handyman',
  moving: 'Moving',
  custom: 'Custom project',
}

const attentionConfig = {
  safety_concern: { label: 'High attention', rank: 1 },
  pending_review: { label: 'High attention', rank: 2 },
  investigating: { label: 'Medium attention', rank: 3 },
  low_rating: { label: 'Medium attention', rank: 4 },
  pricing_dispute: { label: 'Lower attention', rank: 5 },
  no_show: { label: 'Lower attention', rank: 6 },
}

const parseCsv = (text) => Papa.parse(text, { header: true, skipEmptyLines: true }).data
const numberOrNull = (value) => value === '' || value == null ? null : Number(value)
const mapBy = (rows, key) => new Map(rows.map((row) => [row[key], row]))

export const getAttention = (report) => {
  const config = attentionConfig[report.flag_type] || { label: 'Review', rank: 7 }
  const statusRank = report.flag_status === 'pending_review' ? 0 : report.flag_status === 'investigating' ? 1 : 2
  return { ...config, rank: config.rank + statusRank / 10 }
}

export const loadData = async () => {
  if (supabase) return loadSupabaseData()
  const responses = await Promise.all(DATA_FILES.map(async (name) => {
    const response = await fetch(`/data/${name}.csv`)
    if (!response.ok) throw new Error(`Unable to load ${name}.csv`)
    return [name, parseCsv(await response.text())]
  }))
  const raw = Object.fromEntries(responses)
  const customers = raw.customers.map((row) => ({ ...row }))
  const listings = raw.listings.map((row) => ({
    ...row,
    hourly_rate: numberOrNull(row.hourly_rate),
    availability_slots: (() => {
      try { return JSON.parse(row.availability_slots || '[]') } catch { return [] }
    })(),
  }))
  const bookings = raw.bookings.map((row) => ({ ...row, total_cost: numberOrNull(row.total_cost) }))
  const statusOverrides = readStatusOverrides()
  const reports = raw.trust_safety.map((row) => ({
    ...row,
    rating: numberOrNull(row.rating),
    flag_status: statusOverrides[row.report_id] || row.flag_status,
  }))
  const listingById = mapBy(listings, 'listing_id')
  const customerById = mapBy(customers, 'customer_id')

  const enrichedBookings = bookings.map((booking) => ({
    ...booking,
    customer: customerById.get(booking.customer_id),
    listing: listingById.get(booking.listing_id),
    provider_id: listingById.get(booking.listing_id)?.provider_id,
    reports: [],
  }))
  const bookingByIdEnriched = mapBy(enrichedBookings, 'booking_id')
  const enrichedListings = listings.map((listing) => ({ ...listing, reports: [], bookings: [] }))
  const listingByIdEnriched = mapBy(enrichedListings, 'listing_id')
  enrichedBookings.forEach((booking) => listingByIdEnriched.get(booking.listing_id)?.bookings?.push(booking))

  const enrichedReports = reports.map((report) => {
    const booking = report.reference_type === 'booking_id' ? bookingByIdEnriched.get(report.reference_id) : null
    const listing = report.reference_type === 'listing_id'
      ? listingByIdEnriched.get(report.reference_id)
      : booking?.listing
    const enriched = {
      ...report,
      booking,
      listing,
      customer: booking?.customer,
      provider_id: listing?.provider_id || booking?.provider_id,
      service_type: listing?.service_type,
      attention: getAttention(report),
      relationshipAvailable: Boolean(booking || listing),
    }
    listing?.reports?.push(enriched)
    booking?.reports?.push(enriched)
    return enriched
  })

  return {
    customers,
    listings: enrichedListings,
    bookings: enrichedBookings,
    reports: enrichedReports,
    chatbotRequests: raw.chatbot_requests,
  }
}

const loadSupabaseData = async () => {
  const tables = await Promise.all(DATA_FILES.map(async (table) => {
    const { data, error } = await supabase.from(table).select('*')
    if (error) throw new Error(`Unable to load ${table}: ${error.message}`)
    return [table, data || []]
  }))
  const raw = Object.fromEntries(tables)
  const customers = raw.customers.map((row) => ({ ...row }))
  const listings = raw.listings.map((row) => ({
    ...row,
    hourly_rate: numberOrNull(row.hourly_rate),
    availability_slots: Array.isArray(row.availability_slots) ? row.availability_slots : [],
  }))
  const bookings = raw.bookings.map((row) => ({ ...row, total_cost: numberOrNull(row.total_cost) }))
  const reports = raw.trust_safety.map((row) => ({ ...row, rating: numberOrNull(row.rating) }))
  return enrichData({ customers, listings, bookings, reports, chatbotRequests: raw.chatbot_requests })
}

const enrichData = ({ customers, listings, bookings, reports, chatbotRequests }) => {
  const listingById = mapBy(listings, 'listing_id')
  const customerById = mapBy(customers, 'customer_id')
  const enrichedBookings = bookings.map((booking) => ({
    ...booking,
    customer: customerById.get(booking.customer_id),
    listing: listingById.get(booking.listing_id),
    provider_id: listingById.get(booking.listing_id)?.provider_id,
    reports: [],
  }))
  const bookingByIdEnriched = mapBy(enrichedBookings, 'booking_id')
  const enrichedListings = listings.map((listing) => ({ ...listing, reports: [], bookings: [] }))
  const listingByIdEnriched = mapBy(enrichedListings, 'listing_id')
  enrichedBookings.forEach((booking) => listingByIdEnriched.get(booking.listing_id)?.bookings?.push(booking))
  const enrichedReports = reports.map((report) => {
    const booking = report.reference_type === 'booking_id' ? bookingByIdEnriched.get(report.reference_id) : null
    const listing = report.reference_type === 'listing_id' ? listingByIdEnriched.get(report.reference_id) : booking?.listing
    const enriched = {
      ...report,
      booking,
      listing,
      customer: booking?.customer,
      provider_id: listing?.provider_id || booking?.provider_id,
      service_type: listing?.service_type,
      attention: getAttention(report),
      relationshipAvailable: Boolean(booking || listing),
    }
    listing?.reports?.push(enriched)
    booking?.reports?.push(enriched)
    return enriched
  })
  return { customers, listings: enrichedListings, bookings: enrichedBookings, reports: enrichedReports, chatbotRequests }
}

export const readStatusOverrides = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}

export const saveStatusOverride = (reportId, status) => {
  if (supabase) {
    return supabase.from('trust_safety').update({ flag_status: status }).eq('report_id', reportId).then(({ error }) => {
      if (error) throw new Error(`Unable to update report: ${error.message}`)
    })
  }
  const overrides = readStatusOverrides()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...overrides, [reportId]: status }))
  return Promise.resolve()
}

export const getMetrics = (data) => {
  const byFlag = Object.fromEntries(Object.keys(FLAG_LABELS).map((type) => [type, data.reports.filter((report) => report.flag_type === type).length]))
  const byStatus = Object.fromEntries(Object.keys(STATUS_LABELS).map((status) => [status, data.reports.filter((report) => report.flag_status === status).length]))
  const byService = Object.fromEntries(Object.keys(SERVICE_LABELS).map((service) => [service, data.reports.filter((report) => report.service_type === service).length]))
  return {
    total: data.reports.length,
    open: data.reports.filter((report) => report.flag_status !== 'resolved').length,
    pending: byStatus.pending_review,
    investigating: byStatus.investigating,
    resolved: byStatus.resolved,
    safety: byFlag.safety_concern,
    byFlag,
    byStatus,
    byService,
  }
}

export const getProviders = (data) => {
  const providers = new Map()
  data.listings.forEach((listing) => {
    if (!providers.has(listing.provider_id)) providers.set(listing.provider_id, { provider_id: listing.provider_id, listings: [], reports: [] })
    providers.get(listing.provider_id).listings.push(listing)
  })
  data.reports.forEach((report) => {
    if (report.provider_id && providers.has(report.provider_id)) providers.get(report.provider_id).reports.push(report)
  })
  return [...providers.values()].map((provider) => ({
    ...provider,
    serviceTypes: [...new Set(provider.listings.map((listing) => listing.service_type))],
    averageRate: provider.listings.reduce((sum, listing) => sum + (listing.hourly_rate || 0), 0) / (provider.listings.length || 1),
    safetyConcerns: provider.reports.filter((report) => report.flag_type === 'safety_concern').length,
    pricingDisputes: provider.reports.filter((report) => report.flag_type === 'pricing_dispute').length,
    lowRatings: provider.reports.filter((report) => report.flag_type === 'low_rating').length,
    noShows: provider.reports.filter((report) => report.flag_type === 'no_show').length,
  }))
}

export const getCustomers = (data) => data.customers.map((customer) => {
  const bookings = data.bookings.filter((booking) => booking.customer_id === customer.customer_id)
  return { ...customer, bookingCount: bookings.length, reportCount: bookings.reduce((sum, booking) => sum + booking.reports.length, 0) }
})
