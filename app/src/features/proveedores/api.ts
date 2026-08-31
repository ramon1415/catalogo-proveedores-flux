import { supabase } from '../../lib/supabase'
import type { Provider, ProviderPayload } from './types'

// Bucket y esquema de ruta idénticos a upload_helper.js (payment-receipts).
const UPLOAD_BUCKET = 'payment-receipts'

export async function listProviders(): Promise<Provider[]> {
  const { data, error } = await supabase
    .from('proveedores')
    .select('*')
    .order('alias', { ascending: true })
  if (error) throw error
  return (data ?? []) as Provider[]
}

// Guarda vía el mismo RPC que el vanilla; devuelve el id confirmado.
export async function saveProvider(
  providerId: string | null,
  payload: ProviderPayload,
): Promise<string> {
  const { data, error } = await supabase.rpc('save_provider_catalog_with_payment_execution_data', {
    p_proveedor_id: providerId || null,
    p_payload: payload,
  })
  if (error) throw error
  const id = (data as any)?.id
  if (!id) throw { code: 'provider_rpc_response_invalid', message: 'provider_rpc_response_invalid' }
  return id as string
}

// Activar/desactivar: update directo, igual que toggleSupplier del vanilla.
export async function setProviderActive(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase
    .from('proveedores')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

function fileExt(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop()! : 'bin'
}

// Sube la CSF a payment-receipts/csf/{providerId}/{ts}_{rand}.{ext} y vincula la ruta.
export async function uploadProviderCsf(
  providerId: string,
  file: File,
  uploadedBy: string | null,
): Promise<void> {
  const ext = fileExt(file.name)
  const path = `csf/${providerId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error: upErr } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  })
  if (upErr) throw upErr
  const { error: dbErr } = await supabase
    .from('proveedores')
    .update({
      csf_file_path: path,
      csf_uploaded_at: new Date().toISOString(),
      csf_uploaded_by: uploadedBy,
    })
    .eq('id', providerId)
  if (dbErr) throw dbErr
}

export async function getCsfSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw error ?? new Error('signed_url_unavailable')
  return data.signedUrl
}
