const { getSupabaseClient } = require('./supabaseClient');

/**
 * Upload a file buffer to a Supabase Storage bucket.
 */
async function uploadFile(bucket, filePath, buffer, contentType) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType,
      upsert: true
    });

  if (error) throw new Error(`Supabase Storage Upload Error: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return publicUrl;
}

/**
 * Delete a file from a Supabase Storage bucket.
 */
async function deleteFile(bucket, filePath) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.storage
    .from(bucket)
    .remove([filePath]);

  if (error) throw new Error(`Supabase Storage Delete Error: ${error.message}`);
}

module.exports = { uploadFile, deleteFile };
