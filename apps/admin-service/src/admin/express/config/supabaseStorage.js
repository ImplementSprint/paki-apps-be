'use strict';

const { getSupabaseClient } = require('./supabaseClient');

/**
 * Uploads a file buffer to a Supabase storage bucket and returns the public URL.
 * @param {string} bucketName 
 * @param {string} filePath 
 * @param {Buffer} fileBuffer 
 * @param {string} mimeType 
 * @returns {Promise<string>} publicUrl
 */
async function uploadFile(bucketName, filePath, fileBuffer, mimeType) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) {
    throw error;
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  return publicUrlData.publicUrl;
}

/**
 * Deletes a file from a Supabase storage bucket.
 * @param {string} bucketName 
 * @param {string} filePath 
 * @returns {Promise<any>}
 */
async function deleteFile(bucketName, filePath) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(bucketName)
    .remove([filePath]);

  if (error) {
    throw error;
  }

  return data;
}

module.exports = { uploadFile, deleteFile };
