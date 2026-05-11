import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Lazy singleton — the SDK reads credentials and region from process.env
// (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY). We build the client
// on first use so a server without S3 configured (e.g. local dev that
// hasn't set the keys yet) doesn't blow up at import time; it only fails
// when an upload is actually attempted.
let cachedClient = null

function getClient() {
  if (cachedClient) return cachedClient
  if (!process.env.AWS_REGION) {
    throw new Error('AWS_REGION not configured — uploads disabled')
  }
  cachedClient = new S3Client({
    region: process.env.AWS_REGION,
    // Explicit credentials block so we don't accidentally pick up the
    // operator's ambient ~/.aws/credentials in a deployed environment.
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    // Required for presigned browser PUTs. The SDK's 2025+ default
    // ('WHEN_SUPPORTED') auto-injects `x-amz-sdk-checksum-algorithm=CRC32`
    // and `x-amz-checksum-crc32=AAAAAA==` into the presigned URL — those
    // params declare a checksum the browser doesn't compute, and S3 then
    // rejects the actual PUT with a 400 that lacks CORS headers (browser
    // surfaces it as a generic "network error"). WHEN_REQUIRED keeps the
    // URL clean; full-payload integrity is still covered by the SigV4
    // signature on the URL itself.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  return cachedClient
}

export function getBucketName() {
  const name = process.env.S3_BUCKET_NAME
  if (!name) throw new Error('S3_BUCKET_NAME not configured')
  return name
}

// Public read URL for an object key. CloudFront fronts the private bucket,
// so this is the only URL the browser ever sees.
export function publicUrlForKey(key) {
  const base = process.env.S3_PUBLIC_BASE_URL
  if (!base) throw new Error('S3_PUBLIC_BASE_URL not configured')
  // Each key segment may contain characters that need URL-encoding
  // (spaces, etc.). We control the key generator so this is mostly
  // defensive — UUIDs + extensions never need encoding.
  return `${base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
}

// Generate a presigned PUT URL the browser can use to upload directly.
// We don't sign Content-Length-Range as a condition (that's only for POST
// policies); instead the calling endpoint pre-validates `size` so a
// malicious client can't request a presign for a 10 GB upload. The S3
// PUT itself will still respect any Content-Length the browser sends.
export async function createPresignedUploadUrl({ key, contentType, expiresIn = 60 }) {
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(getClient(), command, { expiresIn })
}

export async function deleteObject(key) {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    })
  )
}

// Content-type allow-list used by the upload endpoint. Mirrors the CHECK
// constraint on user_pfps so we can never have a row that violates one
// side or the other.
export const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export function extensionForContentType(contentType) {
  switch (contentType) {
    case 'image/png':  return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif':  return 'gif'
    default: return 'bin'
  }
}
